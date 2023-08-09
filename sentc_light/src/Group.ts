import {
	GroupChildrenListItem,
	GroupData,
	GroupDataCheckUpdateServerOutput, GroupInviteListItem, GroupJoinReqListItem, GroupList, GroupUserListItem,
	HttpMethod,
	USER_KEY_STORAGE_NAMES
} from "./Entities";
import {
	group_accept_join_req,
	group_create_child_group,
	group_create_connected_group,
	group_extract_group_data,
	group_invite_user, group_prepare_update_rank
} from "sentc_wasm_light";
import {User} from "./User";
import {Sentc} from "./Sentc";
import {create_error, handle_general_server_response, handle_server_response, make_req} from "./core";

export async function getGroup(
	group_id: string,
	base_url: string,
	app_token: string,
	user: User,
	parent = false,
	group_as_member?: string,
	rek = false
) {
	const storage = await Sentc.getStore();

	let user_id;

	if (!group_as_member || group_as_member === "") {
		user_id = user.user_data.user_id;
	} else {
		user_id = group_as_member;
	}

	const group_key = USER_KEY_STORAGE_NAMES.groupData + "_user_" + user_id + "_id_" + group_id;

	const group = await storage.getItem<GroupData>(group_key);

	const jwt = await user.getJwt();

	if (group) {
		if (group.last_check_time + 60000 * 5 < Date.now()) {
			//check this every 5 min
			const url = base_url + "/api/v1/group/" + group_id + "/update_check";
			const res = await make_req(HttpMethod.GET, url, app_token, undefined, jwt, group_as_member);
			const out: GroupDataCheckUpdateServerOutput = handle_server_response(res);

			group.rank = out.rank;
			group.last_check_time = Date.now();

			//update the group data in the storage
			await storage.set(group_key, group);
		}

		return new Group(group, base_url, app_token, user);
	}

	const url = base_url + "/api/v1/group/" + group_id;
	const res = await make_req(HttpMethod.GET, url, app_token, undefined, jwt, group_as_member);
	const out = group_extract_group_data(res);

	//check parent or group as member access if the groups are already fetched
	const access_by_parent_group = out.get_access_by_parent_group();
	const access_by_group_as_member = out.get_access_by_group_as_member();

	const parent_group_id = out.get_parent_group_id();

	if (access_by_group_as_member && access_by_group_as_member !== "") {
		//only load the group once even for rek. calls.
		// otherwise when access_by_parent_group is also set this group will be checked again when loading the parent
		if (!rek) {
			//if group as member set. load this group first to get the keys
			//no group as member flag
			await getGroup(access_by_group_as_member, base_url, app_token, user);
		}
	}

	if (access_by_parent_group) {
		parent = true;
		//check if the parent group is fetched
		//rec here because the user might be in a parent of the parent group or so
		//check the tree until we found the group where the user access by user
		await getGroup(parent_group_id, base_url, app_token, user, false, group_as_member, true);
	}

	const group_data: GroupData = {
		group_id: out.get_group_id(),
		parent_group_id,
		from_parent: parent,
		rank: out.get_rank(),
		create_time: out.get_created_time(),
		joined_time: out.get_joined_time(),
		access_by_group_as_member,
		access_by_parent_group,
		is_connected_group: out.get_is_connected_group(),
		last_check_time: Date.now()
	};

	const group_obj = new Group(group_data, base_url, app_token, user);

	await storage.set(group_key, group_data);

	return group_obj;
}


export class Group
{
	constructor(
		public data: GroupData,
		private base_url: string,
		private app_token: string,
		private user: User
	) {}

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

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/children/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const list: GroupChildrenListItem[] = handle_server_response(res);

		return list;
	}

	public async createChildGroup()
	{
		const jwt = await this.user.getJwt();

		return group_create_child_group(this.base_url, this.app_token, jwt, this.data.group_id, this.data.rank, this.data.access_by_group_as_member);
	}

	public async createConnectedGroup()
	{
		const jwt = await this.user.getJwt();

		return group_create_connected_group(this.base_url, this.app_token, jwt, this.data.group_id, this.data.rank, this.data.access_by_group_as_member);
	}

	public async groupUpdateCheck()
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/update_check_light";
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		const out: GroupDataCheckUpdateServerOutput = handle_server_response(res);

		this.data.rank = out.rank;
		this.data.last_check_time = Date.now();
	}

	public async getMember(last_fetched_item: GroupUserListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.joined_time.toString() ?? "0";
		const last_id = last_fetched_item?.user_id ?? "none";

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/member/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const list: GroupUserListItem[] = handle_server_response(res);

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

	public invite(user_id: string, rank?: number)
	{
		return this.inviteUserInternally(user_id, rank);
	}

	public inviteAuto(user_id: string, rank?: number)
	{
		return this.inviteUserInternally(user_id, rank, true);
	}

	public inviteGroup(group_id: string, rank?: number)
	{
		return this.inviteUserInternally(group_id, rank, false, true);
	}

	public inviteGroupAuto(group_id: string, rank?: number)
	{
		return this.inviteUserInternally(group_id, rank, true, true);
	}

	private async inviteUserInternally(user_id: string, rank?: number, auto = false, group = false)
	{
		const jwt = await this.user.getJwt();

		return group_invite_user(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			user_id,
			rank,
			this.data.rank,
			auto,
			group,
			this.data.access_by_group_as_member
		);
	}

	public async getJoinRequests(last_fetched_item: GroupJoinReqListItem | null = null)
	{
		if (this.data.rank > 2) {
			throw create_error("client_201", "No permission to fulfill this action");
		}

		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.user_id ?? "none";

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/join_req/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const reqs: GroupJoinReqListItem[] = handle_server_response(res);

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

	public async acceptJoinRequest(user_id: string, rank?: number)
	{
		const jwt = await this.user.getJwt();

		return group_accept_join_req(
			this.base_url,
			this.app_token,
			jwt,
			this.data.group_id,
			user_id,
			rank,
			this.data.rank,
			this.data.access_by_group_as_member
		);
	}

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
		if (!this.data.access_by_group_as_member) {
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

	public async leave()
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/leave";
		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);
		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________
	//group as member

	public async getGroups(last_fetched_item: GroupList | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/all/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const out: GroupList[] = handle_server_response(res);

		return out;
	}

	//join req to another group to connect
	public async getGroupInvites(last_fetched_item: GroupInviteListItem | null = null)
	{
		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/invite/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const out: GroupInviteListItem[] = handle_server_response(res);

		return out;
	}

	public async acceptGroupInvite(group_id: string)
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/" + group_id + "/invite";

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	public async rejectGroupInvite(group_id: string)
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/" + group_id + "/invite";

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	//join req to another group
	public async groupJoinRequest(group_id: string)
	{
		const jwt = await this.user.getJwt();

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/join_req/" + group_id;

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		return handle_general_server_response(res);
	}

	public async sentJoinReq(last_fetched_item: GroupInviteListItem | null = null)
	{
		if (this.data.rank > 1) {
			throw create_error("client_201", "No permission to fulfill this action");
		}

		const jwt = await this.user.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/" + this.data.group_id + "/joins/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.data.access_by_group_as_member);

		const out: GroupInviteListItem[] = handle_server_response(res);

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
}