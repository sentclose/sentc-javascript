/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/12
 */
import {
	FileCreateOutput,
	FileMetaInformation,
	FilePrepareCreateOutput,
	GroupChildrenListItem,
	GroupData,
	GroupInviteListItem,
	GroupJoinReqListItem,
	GroupKey,
	GroupKeyRotationOut,
	GroupList,
	GroupOutDataKeys,
	GroupUserListItem,
	HttpMethod,
	KeyRotationInput,
	USER_KEY_STORAGE_NAMES,
	UserKeyData
} from "./Enities";
import {
	file_delete_file,
	group_accept_join_req,
	group_create_child_group,
	group_create_connected_group,
	group_decrypt_key,
	group_done_key_rotation,
	group_finish_key_rotation,
	group_get_all_first_level_children,
	group_get_done_key_rotation_server_input,
	group_get_group_data,
	group_get_group_key,
	group_get_group_keys,
	group_get_group_updates,
	group_get_groups_for_user,
	group_get_invites_for_user,
	group_get_join_reqs,
	group_get_member,
	group_get_sent_join_req,
	group_invite_user,
	group_invite_user_session,
	group_join_user_session,
	group_key_rotation,
	group_pre_done_key_rotation,
	group_prepare_create_group,
	group_prepare_key_rotation,
	group_prepare_keys_for_new_member,
	group_prepare_update_rank
} from "sentc_wasm";
import {Sentc} from "./Sentc";
import {AbstractSymCrypto} from "./crypto/AbstractSymCrypto";
import {User} from "./User";
import {Downloader, Uploader} from "./file";
import {SymKey} from ".";
import {create_error, handle_general_server_response, make_req} from "./core";

export function prepareKeys(keys: GroupKey[] | UserKeyData[], page = 0): [string, boolean]
{
	const offset = page * 50;
	const end = offset + 50;

	const key_slice = keys.slice(offset, end);

	let str = "[";

	for (let i = 0; i < key_slice.length; i++) {
		const key = keys[i].group_key;

		str += key + ",";
	}

	//remove the trailing comma
	str = str.slice(0, -1);

	str += "]";

	//it must be this string: [{"Aes":{"key":"D29y+nli2g4wn1GawdVmeGyo+W8HKc1cllkzqdEA2bA=","key_id":"123"}}]
	
	return [str, end < keys.length - 1];
}

/**
 * Get a group, from the storage or the server
 *
 */
export async function getGroup(group_id: string, base_url: string, app_token: string, user: User, parent = false, group_as_member = "", rek = false)
{
	const storage = await Sentc.getStore();

	let user_id;

	if (group_as_member === "") {
		user_id = user.user_data.user_id;
	} else {
		user_id = group_as_member;
	}

	const group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + user_id + "_id_" + group_id;

	const group: GroupData = await storage.getItem(group_key);

	const jwt = await user.getJwt();

	if (group) {
		const update = await group_get_group_updates(base_url, app_token, jwt, group_id, group_as_member);

		group.rank = update.get_rank();
		group.key_update = update.get_key_update();

		return new Group(group, base_url, app_token, user);
	}

	const out = await group_get_group_data(
		base_url,
		app_token,
		jwt,
		group_id,
		group_as_member
	);

	//save the fetched keys but only decrypt them when creating the group obj
	const fetched_keys: GroupOutDataKeys[] = out.get_keys();

	//check parent or group as member access if the groups are already fetched
	const access_by_parent_group = out.get_access_by_parent_group();
	let access_by_group_as_member = out.get_access_by_group_as_member();

	const parent_group_id = out.get_parent_group_id();

	if (access_by_group_as_member && access_by_group_as_member !== "") {
		//only load the group once even for rek. calls.
		// otherwise when access_by_parent_group is also set this group will be checked again when loading the parent
		if (!rek) {
			//if group as member set. load this group first to get the keys
			//no group as member flag
			await getGroup(access_by_group_as_member, base_url, app_token, user);
		}
	} else {
		//set the default value
		access_by_group_as_member = "";
	}

	if (access_by_parent_group) {
		parent = true;
		//check if the parent group is fetched
		//rec here because the user might be in a parent of the parent group or so
		//check the tree until we found the group where the user access by user
		await getGroup(parent_group_id, base_url, app_token, user, false, group_as_member, true);
	}

	let group_data: GroupData = {
		group_id: out.get_group_id(),
		parent_group_id,
		from_parent: parent,
		rank: out.get_rank(),
		key_update: out.get_key_update(),
		create_time: out.get_created_time(),
		joined_time: out.get_joined_time(),
		keys: [],
		key_map: new Map(),
		newest_key_id: "",
		access_by_group_as_member,
		access_by_parent_group,
		is_connected_group: out.get_is_connected_group()
	};

	const group_obj = new Group(group_data, base_url, app_token, user);

	//update the group obj and the group data (which we saved in store) with the decrypted keys.
	//it is ok to use the private key with an empty array,
	// because we are using the keys of the parent group when this is a child group
	const keys = await group_obj.decryptKey(fetched_keys);
	group_data.keys = keys;
	group_obj.groupKeys = keys;

	const key_map: Map<string, number> = new Map();

	//get the newest key
	const newest_key_id = keys[0].group_key_id;

	//insert in the key map
	for (let i = 0; i < keys.length; i++) {
		key_map.set(keys[i].group_key_id, i);
	}
	group_data.key_map = key_map;
	group_data.newest_key_id = newest_key_id;
	group_obj.groupKeyMap = key_map;
	group_obj.data.newest_key_id = newest_key_id;

	if (keys.length >= 50) {
		//fetch the rest of the keys via pagination, get the updated data back
		group_data = await group_obj.fetchKeys(jwt);
	}

	//store the group data
	await storage.set(group_key, group_data);

	return group_obj;
}

export class Group extends AbstractSymCrypto
{
	constructor(public data: GroupData, base_url: string, app_token: string, private user: User) {
		super(base_url, app_token);
	}

	set groupKeys(keys: GroupKey[])
	{
		this.data.keys = keys;
	}

	set groupKeyMap(key_map: Map<string, number>)
	{
		this.data.key_map = key_map;
	}

	//__________________________________________________________________________________________________________________

	public getChildGroup(group_id: string)
	{
		return getGroup(group_id, this.base_url, this.app_token, this.user, true, this.data.access_by_group_as_member);
	}

	public getConnectedGroup(group_id: string)
	{
		//access the connected group from this group
		return getGroup(group_id, this.base_url, this.app_token, this.user, false, this.data.group_id);
	}

	public async getChildren(last_fetched_item: GroupChildrenListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const list: GroupChildrenListItem[] = await group_get_all_first_level_children(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			last_fetched_time,
			last_id,
			this.data.access_by_group_as_member
		);

		return list;
	}

	public prepareCreateChildGroup()
	{
		const latest_key = this.getNewestKey();

		const group_input = group_prepare_create_group(latest_key.public_group_key);

		return [group_input, latest_key.group_key_id];
	}

	public async createChildGroup()
	{
		const latest_key = this.getNewestKey().public_group_key;

		const jwt = await this.user.getJwt();

		return group_create_child_group(this.base_url, this.app_token, jwt, latest_key, this.data.group_id, this.data.rank, this.data.access_by_group_as_member);
	}

	public async createConnectedGroup()
	{
		const latest_key = this.getNewestKey().public_group_key;

		const jwt = await this.user.getJwt();

		return group_create_connected_group(this.base_url, this.app_token, jwt, this.data.group_id, this.data.rank, latest_key, this.data.access_by_group_as_member);
	}

	public async getMember(last_fetched_item: GroupUserListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.joined_time.toString() ?? "0";
		const last_id = last_fetched_item?.user_id ?? "none";

		const list: GroupUserListItem[] = await group_get_member(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			last_fetched_time,
			last_id,
			this.data.access_by_group_as_member
		);

		return list;
	}

	public async stopInvites()
	{
		if (this.data.rank > 1) {
			throw create_error("client_201", "No permission to fulfill this action");
		}

		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/change_invite";
		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		return handle_general_server_response(res);
	}

	public async prepareKeysForNewMember(user_id: string, page = 0, group = false)
	{
		const key_count = this.data.keys.length;

		let public_key;

		if (group) {
			public_key = await Sentc.getGroupPublicKeyData(this.base_url, this.app_token, user_id);
		} else {
			public_key = await Sentc.getUserPublicKeyData(this.base_url, this.app_token, user_id);
		}

		const [key_string] = this.prepareKeys(page);

		return group_prepare_keys_for_new_member(public_key.key, key_string, key_count, this.data.rank);
	}

	public invite(user_id: string)
	{
		return this.inviteUserInternally(user_id);
	}

	public inviteAuto(user_id: string)
	{
		return this.inviteUserInternally(user_id, true);
	}

	public inviteGroup(group_id: string)
	{
		return this.inviteUserInternally(group_id, false, true);
	}

	public inviteGroupAuto(group_id: string)
	{
		return this.inviteUserInternally(group_id, true, true);
	}

	private async inviteUserInternally(user_id: string, auto = false, group = false)
	{
		let public_key;

		if (group) {
			public_key = await Sentc.getGroupPublicKeyData(this.base_url, this.app_token, user_id);
		} else {
			public_key = await Sentc.getUserPublicKeyData(this.base_url, this.app_token, user_id);
		}

		const key_count = this.data.keys.length;
		const [key_string] = this.prepareKeys();

		const jwt = await this.user.getJwt();

		const session_id = await group_invite_user(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			user_id,
			key_count,
			this.data.rank,
			auto,
			group,
			public_key.key,
			key_string, this.data.access_by_group_as_member
		);

		if (session_id === "") {
			return;
		}

		//upload the rest of the keys via session
		let next_page = true;
		let i = 1;
		const p = [];

		while (next_page) {
			const next_keys = this.prepareKeys(i);
			next_page = next_keys[1];

			p.push(group_invite_user_session(
				this.base_url,
				this.app_token,
				jwt,
				this.data.group_id,
				auto,
				session_id,
				public_key.key,
				next_keys[0],
				this.data.access_by_group_as_member
			));

			i++;
		}

		return Promise.allSettled(p);
	}

	//__________________________________________________________________________________________________________________
	//join req

	public async getJoinRequests(last_fetched_item: GroupJoinReqListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.user_id ?? "none";

		const reqs: GroupJoinReqListItem[] = await group_get_join_reqs(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			this.data.rank,
			last_fetched_time,
			last_id,
			this.data.access_by_group_as_member
		);

		return reqs;
	}

	public async rejectJoinRequest(user_id: string)
	{
		if (this.data.rank > 2) {
			throw create_error("client_201", "No permission to fulfill this action");
		}

		const jwt = await this.user.getJwt();
		
		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/join_req/" + user_id;
		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		return handle_general_server_response(res);
	}

	public async acceptJoinRequest(user_id: string, user_type: 0 | 2 = 0)
	{
		const jwt = await this.user.getJwt();
		const key_count = this.data.keys.length;
		const [key_string] = this.prepareKeys();

		let public_key;

		if (user_type === 2) {
			public_key = await Sentc.getGroupPublicKeyData(this.base_url, this.app_token, user_id);
		} else {
			public_key = await Sentc.getUserPublicKeyData(this.base_url, this.app_token, user_id);
		}

		const session_id = await group_accept_join_req(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			user_id,
			key_count,
			this.data.rank,
			public_key.key,
			key_string,
			this.data.access_by_group_as_member
		);

		if (session_id === "") {
			return;
		}

		let next_page = true;
		let i = 1;
		const p = [];

		while (next_page) {
			const next_keys = this.prepareKeys(i);
			next_page = next_keys[1];

			p.push(group_join_user_session(
				this.base_url,
				this.app_token,
				jwt,
				this.data.group_id,
				session_id,
				public_key.key,
				next_keys[0],
				this.data.access_by_group_as_member
			));

			i++;
		}

		return Promise.allSettled(p);
	}

	//__________________________________________________________________________________________________________________

	public async leave()
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/leave";
		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________
	//key rotation

	/**
	 * Get the actual used public key.
	 * For the user, or if user joined via parent group the parent group public key
	 *
	 * Returns only the public key format, not the exported public key!
	 *
	 * @private
	 */
	private async getPublicKey()
	{
		//normal user access
		if (!this.data.from_parent && (!this.data.access_by_group_as_member || this.data.access_by_group_as_member === "")) {
			return this.user.getNewestPublicKey();
		}

		//access with parent group -> get the keys from the parent group
		//no need to change for group as member because we are using the keys of the parent
		if (this.data.from_parent) {
			//choose the right user id.
			// when the user is accessing the group over a parent which is also access by a connected group
			let user_id;
			if (this.data.access_by_group_as_member === "") {
				user_id = this.user.user_data.user_id;
			} else {
				user_id = this.data.access_by_group_as_member;
			}

			//get parent group public key
			const storage = await Sentc.getStore();
			const parent_group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + user_id + "_id_" + this.data.parent_group_id;
			const parent_group: GroupData = await storage.getItem(parent_group_key);

			if (!parent_group) {
				throw new Error("Parent group not found. This group was access from parent group but the parent group data is gone.");
			}

			const newest_key_id = parent_group.newest_key_id;
			const index = parent_group.key_map.get(newest_key_id);

			if (index === undefined) {
				throw new Error("Parent group not found. This group was access from parent group but the parent group data is gone.");
			}

			//use the latest key
			const public_key = parent_group.keys[index]?.public_group_key;

			if (!public_key) {
				throw new Error("Parent group not found. This group was access from parent group but the parent group data is gone.");
			}

			return public_key;
		}

		//access not over parent but from group as member -> use the keys from the group as member
		const storage = await Sentc.getStore();
		const connected_group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + this.user.user_data.user_id + "_id_" + this.data.access_by_group_as_member;
		const connected_group: GroupData = await storage.getItem(connected_group_key);

		if (!connected_group) {
			throw new Error("Connected group not found. This group was access from a connected group but the group data is gone.");
		}

		const newest_key_id = connected_group.newest_key_id;
		const index = connected_group.key_map.get(newest_key_id);

		if (index === undefined) {
			throw new Error("Connected group not found. This group was access from a connected group but the group data is gone.");
		}

		//use the latest key
		const public_key = connected_group.keys[index]?.public_group_key;

		if (!public_key) {
			throw new Error("Connected group not found. This group was access from a connected group but the group data is gone.");
		}

		return public_key;
	}

	private getNewestKey()
	{
		let index = this.data.key_map.get(this.data.newest_key_id);

		if (!index) {
			index = 0;
		}

		return this.data.keys[index];
	}

	/**
	 * Gets the right private key to the used public key
	 *
	 * If it is from user -> get it from user
	 *
	 * If not then form the parent group
	 *
	 * @param private_key_id
	 * @private
	 */
	private async getPrivateKey(private_key_id: string)
	{
		if (!this.data.from_parent && (!this.data.access_by_group_as_member || this.data.access_by_group_as_member === "")) {
			return this.user.getPrivateKey(private_key_id);
		}

		if (this.data.from_parent) {
			let user_id;
			if (this.data.access_by_group_as_member === "") {
				user_id = this.user.user_data.user_id;
			} else {
				user_id = this.data.access_by_group_as_member;
			}

			//get parent group private key
			const storage = await Sentc.getStore();
			const parent_group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + user_id + "_id_" + this.data.parent_group_id;
			const parent_group_data: GroupData = await storage.getItem(parent_group_key);

			if (!parent_group_data) {
				throw new Error("Parent group not found. This group was access from parent group but the parent group data is gone.");
			}

			const parent_group = new Group(parent_group_data, this.base_url, this.app_token, this.user);

			//private key id got the same id as the group key
			const group_key = await parent_group.getGroupKey(private_key_id);

			//use the latest key
			return group_key.private_group_key;
		}

		//access over group as member
		const storage = await Sentc.getStore();
		const connected_group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + this.user.user_data.user_id + "_id_" + this.data.access_by_group_as_member;
		const connected_group_data: GroupData = await storage.getItem(connected_group_key);

		if (!connected_group_data) {
			throw new Error("Connected group not found. This group was access from a connected group but the group data is gone.");
		}

		const connected_group = new Group(connected_group_data, this.base_url, this.app_token, this.user);

		const group_key = await connected_group.getGroupKey(private_key_id);

		return group_key.private_group_key;
	}

	private getKeyRotationServerOut(server_output: string): KeyRotationInput
	{
		const de_server_output = group_get_done_key_rotation_server_input(server_output);

		return {
			encrypted_eph_key_key_id: de_server_output.get_encrypted_eph_key_key_id(),
			encrypted_ephemeral_key_by_group_key_and_public_key: de_server_output.get_encrypted_ephemeral_key_by_group_key_and_public_key(),
			encrypted_group_key_by_ephemeral: de_server_output.get_encrypted_group_key_by_ephemeral(),
			ephemeral_alg: de_server_output.get_ephemeral_alg(),
			new_group_key_id: de_server_output.get_new_group_key_id(),
			previous_group_key_id: de_server_output.get_previous_group_key_id(),
			time: de_server_output.get_time()
		};
	}

	/**
	 * Prepares the key rotation to use it with own backend.
	 *
	 * The newest public key is used to encrypt the key for the starter.
	 * If the starter joined via parent group then the parent group public key is used
	 */
	public async prepareKeyRotation()
	{
		//if this is a child group -> start the key rotation with the parent key!
		const public_key = await this.getPublicKey();

		return group_prepare_key_rotation(this.getNewestKey().group_key, public_key);
	}

	public async doneKeyRotation(server_output: string)
	{
		const out = this.getKeyRotationServerOut(server_output);

		const [public_key, private_key] = await Promise.all([
			this.getPublicKey(),
			this.getPrivateKey(out.encrypted_eph_key_key_id)
		]);

		return group_done_key_rotation(private_key, public_key, this.getNewestKey().group_key, server_output);
	}

	public async keyRotation()
	{
		const jwt = await this.user.getJwt();

		const public_key = await this.getPublicKey();

		const key_id = await group_key_rotation(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			public_key,
			this.getNewestKey().group_key,
			this.data.access_by_group_as_member
		);

		return this.getGroupKey(key_id, true);
	}

	public async finishKeyRotation()
	{
		const jwt = await this.user.getJwt();

		let keys: GroupKeyRotationOut[] = await group_pre_done_key_rotation(this.base_url, this.app_token, jwt, this.data.group_id, this.data.access_by_group_as_member);

		if (keys.length === 0) {
			return; 
		}

		let next_round = false;
		let rounds_left = 10;

		//use always the newest public key
		const public_key = await this.getPublicKey();

		do {
			const left_keys = [];

			//should be always there because the group rotation keys are ordered by time
			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];

				let pre_key;

				try {
					// eslint-disable-next-line no-await-in-loop
					pre_key = await this.getGroupKey(key.pre_group_key_id);
					// eslint-disable-next-line no-empty
				} catch (e) {
					//key not found -> try the next round
				}

				if (pre_key === undefined) {
					left_keys.push(key);
					continue;
				}

				//get the right used private key for each key
				// eslint-disable-next-line no-await-in-loop
				const private_key = await this.getPrivateKey(key.encrypted_eph_key_key_id);

				//await must be in this loop because we need the keys
				// eslint-disable-next-line no-await-in-loop
				await group_finish_key_rotation(
					this.base_url,
					this.app_token,
					jwt,
					this.data.group_id,
					key.server_output,
					pre_key.group_key,
					public_key,
					private_key,
					this.data.access_by_group_as_member
				);
				
				//now get the new key and safe it
				// eslint-disable-next-line no-await-in-loop
				await this.getGroupKey(key.new_group_key_id, true);
			}

			//when it runs 10 times and there are still left -> break up
			rounds_left--;

			if (left_keys.length > 0) {
				keys = [];
				//push the not found keys into the key array, maybe the pre group keys are in the next round
				keys.push(...left_keys);

				next_round = true;
			} else {
				next_round = false;
			}
		} while (next_round && rounds_left > 0);

		let user_id;
		if (this.data.access_by_group_as_member === "") {
			user_id = this.user.user_data.user_id;
		} else {
			user_id = this.data.access_by_group_as_member;
		}

		//after a key rotation -> save the new group data in the store
		const storage = await Sentc.getStore();
		const group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + user_id + "_id_" + this.data.group_id;
		return storage.set(group_key, this.data);
	}

	//__________________________________________________________________________________________________________________

	public prepareUpdateRank(user_id: string, new_rank: number)
	{
		return group_prepare_update_rank(user_id, new_rank, this.data.rank);
	}

	public async updateRank(user_id: string, new_rank: number)
	{
		const jwt = await this.user.getJwt();

		//check if the updated user is the actual user -> then update the group store

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/change_rank";

		const body = this.prepareUpdateRank(user_id, new_rank);
		const res = await make_req(HttpMethod.PUT, url, this.app_token, body, jwt, this.data.access_by_group_as_member);

		handle_general_server_response(res);
		
		let actual_user_id;
		if (this.data.access_by_group_as_member === "") {
			actual_user_id = this.user.user_data.user_id;
		} else {
			actual_user_id = this.data.access_by_group_as_member;
		}

		if (actual_user_id === user_id) {
			const storage = await Sentc.getStore();
			const group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + actual_user_id + "_id_" + this.data.group_id;

			this.data.rank = new_rank;

			return storage.set(group_key, this.data);
		}
	}

	public async kickUser(user_id: string)
	{
		if (this.data.rank > 2) {
			throw create_error("client_201", "No permission to fulfill this action");
		}

		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/kick/" + user_id;

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________
	//group as member

	public async getGroups(last_fetched_item: GroupList | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const out: GroupList[] = await group_get_groups_for_user(
			this.base_url,
			this.app_token,
			jwt,
			last_fetched_time,
			last_id,
			this.data.group_id
		);

		return out;
	}

	//join req to another group to connect
	public async getGroupInvites(last_fetched_item: GroupInviteListItem | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const out: GroupInviteListItem[] = await group_get_invites_for_user(
			this.base_url,
			this.app_token,
			jwt,
			last_fetched_time,
			last_id,
			this.data.group_id,
			this.data.access_by_group_as_member
		);

		return out;
	}

	public async acceptGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/" + group_id + "/invite";

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	public async rejectGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/" + group_id + "/invite";

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	//join req to another group
	public async groupJoinRequest(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/join_req/" + group_id;

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	public async sentJoinReq(last_fetched_item: GroupInviteListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const out: GroupInviteListItem[] = await group_get_sent_join_req(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			this.data.rank,
			last_fetched_time,
			last_id,
			this.data.access_by_group_as_member
		);

		return out;
	}

	public async deleteJoinReq(id: string)
	{
		if (this.data.rank > 1) {
			throw create_error("client_201", "No permission to fulfill this action");
		}
		
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/joins/" + id;

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________

	public async deleteGroup()
	{
		if (this.data.rank > 1) {
			throw create_error("client_201", "No permission to fulfill this action");
		}
		
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id;

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		
		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________

	public async fetchKeys(jwt: string)
	{
		let last_item = this.data.keys[this.data.keys.length - 1];

		let next_fetch = true;

		const keys: GroupKey[] = [];

		while (next_fetch) {
			// eslint-disable-next-line no-await-in-loop
			const fetchedKeys: GroupOutDataKeys[] = await group_get_group_keys(
				this.base_url,
				this.app_token,
				jwt,
				this.data.group_id,
				last_item.time,
				last_item.group_key_id,
				this.data.access_by_group_as_member
			);

			// eslint-disable-next-line no-await-in-loop
			const decrypted_key = await this.decryptKey(fetchedKeys);

			keys.push(...decrypted_key);

			next_fetch = fetchedKeys.length >= 50;

			last_item = decrypted_key[fetchedKeys.length - 1];
		}

		const last_inserted_key_index = this.data.keys.length;

		//insert in the key map
		for (let i = 0; i < keys.length; i++) {
			this.data.key_map.set(keys[i].group_key_id, i + last_inserted_key_index);
		}

		this.data.keys.push(...keys);

		//return the updated data, so it can be saved in the store
		return this.data;
	}

	/**
	 * Decrypt the key with the right private key.
	 *
	 * get the right private key for each key
	 *
	 * @param fetchedKeys
	 */
	public async decryptKey(fetchedKeys: GroupOutDataKeys[]): Promise<GroupKey[]>
	{
		const keys: GroupKey[] = [];

		for (let i = 0; i < fetchedKeys.length; i++) {
			const fetched_key = fetchedKeys[i];

			// eslint-disable-next-line no-await-in-loop
			const private_key = await this.getPrivateKey(fetched_key.private_key_id);

			const decrypted_keys = group_decrypt_key(private_key, fetched_key.key_data);

			keys.push({
				group_key_id: decrypted_keys.get_group_key_id(),
				group_key: decrypted_keys.get_group_key(),
				private_group_key: decrypted_keys.get_private_group_key(),
				time: decrypted_keys.get_time(),
				public_group_key: decrypted_keys.get_public_group_key()
			});
		}

		return keys;
	}

	private prepareKeys(page = 0): [string, boolean]
	{
		return prepareKeys(this.data.keys, page);
	}

	private async getGroupKey(key_id: string, new_keys = false)
	{
		let key_index = this.data.key_map.get(key_id);

		if (key_index === undefined) {
			const jwt = await this.user.getJwt();

			const fetched_key = await group_get_group_key(this.base_url, this.app_token, jwt, this.data.group_id, key_id, this.data.access_by_group_as_member);

			const key: GroupOutDataKeys = {
				key_data: fetched_key.get_key_data(),
				private_key_id: fetched_key.get_private_key_id()
			};

			const decrypted_key = await this.decryptKey([key]);

			const last_inserted_key_index = this.data.keys.length;
			this.data.keys.push(decrypted_key[0]);
			this.data.key_map.set(decrypted_key[0].group_key_id, last_inserted_key_index);

			if (new_keys) {
				this.data.newest_key_id = decrypted_key[0].group_key_id;
			}

			let actual_user_id;
			if (this.data.access_by_group_as_member === "") {
				actual_user_id = this.user.user_data.user_id;
			} else {
				actual_user_id = this.data.access_by_group_as_member;
			}

			const storage = await Sentc.getStore();
			const group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + actual_user_id + "_id_" + this.data.group_id;

			await storage.set(group_key, this.data);

			key_index = this.data.key_map.get(key_id);
			if (!key_index) {
				//key not found
				throw new Error("Group key not found. Maybe done key rotation will help");
			}
		}

		const key = this.data.keys[key_index];
		if (!key) {
			//key not found
			throw new Error("Group key not found. Maybe done key rotation will help");
		}

		return key;
	}

	//__________________________________________________________________________________________________________________

	getSymKeyToEncrypt(): Promise<[string, string]>
	{
		const latest_key = this.getNewestKey();

		return Promise.resolve([latest_key.group_key, latest_key.group_key_id]);
	}

	async getSymKeyById(key_id: string): Promise<string>
	{
		const key = await this.getGroupKey(key_id);

		return key.group_key;
	}

	getJwt(): Promise<string>
	{
		return this.user.getJwt();
	}

	getSignKey(): Promise<string>
	{
		//always use the users sign key
		return this.user.getSignKey();
	}

	//__________________________________________________________________________________________________________________

	public async prepareRegisterFile(file: File): Promise<FilePrepareCreateOutput>
	{
		const key = await this.registerKey();

		const uploader = new Uploader(this.base_url, this.app_token, this.user, this.data.group_id, this.data.access_by_group_as_member);

		const [server_input, encrypted_file_name] =  uploader.prepareFileRegister(file, key.key, key.master_key_id);

		return {
			server_input,
			encrypted_file_name,
			key,
			master_key_id: key.master_key_id
		};
	}

	public doneFileRegister(server_output: string)
	{
		const uploader = new Uploader(this.base_url, this.app_token, this.user, this.data.group_id, this.data.access_by_group_as_member);

		uploader.doneFileRegister(server_output);
	}
	
	public uploadFile(file: File, content_key: SymKey): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: true): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: false, upload_callback: (progress?: number) => void): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: true, upload_callback: (progress?: number) => void): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign = false, upload_callback?: (progress?: number) => void)
	{
		const uploader = new Uploader(this.base_url, this.app_token, this.user, this.data.group_id, undefined, upload_callback, this.data.access_by_group_as_member);

		return uploader.uploadFile(file, content_key.key, content_key.master_key_id, sign);
	}

	//__________________________________________________________________________________________________________________

	public createFile(file: File): Promise<FileCreateOutput>;

	public createFile(file: File, sign: true): Promise<FileCreateOutput>;

	public createFile(file: File, sign: false, upload_callback: (progress?: number) => void): Promise<FileCreateOutput>;

	public createFile(file: File, sign: true, upload_callback: (progress?: number) => void): Promise<FileCreateOutput>;

	public async createFile(file: File, sign = false, upload_callback?: (progress?: number) => void)
	{
		//1st register a new key for this file
		const key = await this.registerKey();

		//2nd encrypt and upload the file, use the created key
		const uploader = new Uploader(this.base_url, this.app_token, this.user, this.data.group_id, undefined, upload_callback, this.data.access_by_group_as_member);

		const [file_id, encrypted_file_name] = await uploader.uploadFile(file, key.key, key.master_key_id, sign);

		return {
			file_id,
			master_key_id: key.master_key_id,
			encrypted_file_name
		};
	}

	public downloadFile(file_id: string): Promise<[string, FileMetaInformation, SymKey]>;

	public downloadFile(file_id: string, verify_key: string): Promise<[string, FileMetaInformation, SymKey]>;

	public downloadFile(file_id: string, verify_key: string, updateProgressCb: (progress: number) => void): Promise<[string, FileMetaInformation, SymKey]>;

	public async downloadFile(file_id: string, verify_key = "", updateProgressCb?: (progress: number) => void)
	{
		const downloader = new Downloader(this.base_url, this.app_token, this.user, this.data.group_id, this.data.access_by_group_as_member);

		//1. get the file info
		const file_meta = await downloader.downloadFileMetaInformation(file_id);

		//2. get the content key which was used to encrypt the file
		const key_id = file_meta.key_id;
		const key = await this.fetchKey(key_id, file_meta.master_key_id);

		//3. get the file name if any
		if (file_meta.encrypted_file_name && file_meta.encrypted_file_name !== "") {
			file_meta.file_name = key.decryptString(file_meta.encrypted_file_name, verify_key);
		}

		const url = await downloader.downloadFileParts(file_meta.part_list, key.key, updateProgressCb, verify_key);

		return [
			url,
			file_meta,
			key
		];
	}

	public async deleteFile(file_id: string)
	{
		const jwt = await this.getJwt();

		return file_delete_file(this.base_url, this.app_token, jwt, file_id, this.data.group_id, this.data.access_by_group_as_member);
	}
}
