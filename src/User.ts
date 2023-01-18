import {AbstractAsymCrypto} from "./crypto/AbstractAsymCrypto";
import {
	FileCreateOutput,
	FileMetaInformation, FilePrepareCreateOutput,
	GroupInviteListItem, GroupKeyRotationOut,
	GroupList, HttpMethod,
	USER_KEY_STORAGE_NAMES,
	UserData, UserDeviceList, UserKeyData
} from "./Enities";
import {
	change_password,
	decode_jwt,
	delete_device,
	delete_user,
	done_fetch_user_key,
	fetch_user_key,
	file_delete_file,
	file_file_name_update,
	group_create_group, group_decrypt_hmac_key,
	group_prepare_create_group,
	prepare_register_device,
	register_device,
	reset_password,
	user_device_key_session_upload,
	user_finish_key_rotation,
	user_key_rotation,
	user_pre_done_key_rotation,
	user_prepare_user_identifier_update
} from "sentc_wasm";
import {REFRESH_ENDPOINT, Sentc} from "./Sentc";
import {getGroup, prepareKeys} from "./Group";
import {Downloader, Uploader} from "./file";
import {SymKey} from ".";
import {handle_general_server_response, handle_server_response, make_req} from "./core";

export async function getUser(deviceIdentifier: string, user_data: UserData)
{
	//Only fetch the older keys when needed, this is not like a group where all keys must be available

	//user key map
	const key_map = user_data.key_map;

	for (let i = 0; i < user_data.user_keys.length; i++) {
		key_map.set(user_data.user_keys[i].group_key_id, i);
	}

	user_data.key_map = key_map;
	user_data.newest_key_id = user_data.user_keys[0].group_key_id;

	const store_user_data = user_data;

	if (Sentc.options.refresh.endpoint !== REFRESH_ENDPOINT.api) {
		//if the refresh token should not be stored on the client -> invalidates the stored refresh token
		//but just return the refresh token with the rest of the user data
		store_user_data.refresh_token = "";
	}

	const user = new User(Sentc.options.base_url, Sentc.options.app_token, user_data, deviceIdentifier);

	//decrypt the hmac key
	const hmac_encrypted_key = await user.getUserSymKey(user_data.encrypted_hmac_encryption_key_id);
	const decrypted_hmac_key = group_decrypt_hmac_key(hmac_encrypted_key, user_data.encrypted_hmac_key, user_data.encrypted_hmac_alg);
	
	user.user_data.hmac_key = decrypted_hmac_key;
	store_user_data.hmac_key = decrypted_hmac_key;

	//save user data in indexeddb
	const storage = await Sentc.getStore();

	await Promise.all([
		storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + deviceIdentifier, store_user_data),
		storage.set(USER_KEY_STORAGE_NAMES.actualUser, deviceIdentifier),
		//save always the newest public key
		storage.set(USER_KEY_STORAGE_NAMES.userPublicKey + "_id_" + user_data.user_id, {key: user_data.user_keys[0].exported_public_key, id: user_data.user_keys[0].group_key_id})
	]);

	return user;
}

export class User extends AbstractAsymCrypto
{
	constructor(
		base_url: string,
		app_token: string,
		public user_data: UserData,
		private userIdentifier: string,
		public group_invites: GroupInviteListItem[] = []
	) {
		super(base_url, app_token);
	}

	private async getUserKeys(key_id: string, first = false)
	{
		let index = this.user_data.key_map.get(key_id);

		if (index === undefined) {
			//try to fetch the keys from the server
			await this.fetchUserKey(key_id, first);

			index = this.user_data.key_map.get(key_id);

			if (index === undefined) {
				//key not found
				throw new Error("Key not found");
			}
		}

		const key = this.user_data.user_keys[index];

		if (!key) {
			//key not found
			throw new Error("Key not found");
		}

		return key;
	}

	async getUserSymKey(key_id: string): Promise<string>
	{
		const key = await this.getUserKeys(key_id);

		return key.group_key;
	}

	async getPrivateKey(key_id: string): Promise<string>
	{
		const key = await this.getUserKeys(key_id);

		return key.private_key;
	}

	async getPublicKey(reply_id: string): Promise<[string, string]>
	{
		const public_key = await Sentc.getUserPublicKeyData(this.base_url, this.app_token, reply_id);

		return [public_key.key, public_key.id];
	}

	private getNewestKey()
	{
		let index = this.user_data.key_map.get(this.user_data.newest_key_id);

		if (index === undefined) {
			index = 0;
		}

		return this.user_data.user_keys[index];
	}

	public getNewestPublicKey()
	{
		return this.getNewestKey().public_key;
	}

	public getNewestSignKey()
	{
		return this.getNewestKey().sign_key;
	}

	getSignKey(): Promise<string>
	{
		return Promise.resolve(this.getNewestSignKey());
	}

	public doneFetchUserKey(server_output: string)
	{
		const user_keys: UserKeyData = done_fetch_user_key(this.user_data.device.private_key, server_output);

		const index = this.user_data.user_keys.length;
		this.user_data.user_keys.push(user_keys);

		this.user_data.key_map.set(user_keys.group_key_id, index);
	}

	public async fetchUserKey(key_id: string, first = false)
	{
		const jwt = await this.getJwt();

		const user_keys: UserKeyData = await fetch_user_key(this.base_url, this.app_token, jwt, key_id, this.user_data.device.private_key);

		const index = this.user_data.user_keys.length;
		this.user_data.user_keys.push(user_keys);

		this.user_data.key_map.set(user_keys.group_key_id, index);
		
		if (first) {
			this.user_data.newest_key_id = user_keys.group_key_id;
		}

		const storage = await Sentc.getStore();

		return storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + this.userIdentifier, this.user_data);
	}

	public async getJwt()
	{
		const jwt_data = decode_jwt(this.user_data.jwt);

		const exp = jwt_data.get_exp();

		if (exp <= Date.now() / 1000 + 30) {
			//refresh even when the jwt is valid for 30 sec
			//update the user data to safe the updated values, we don't need the class here
			this.user_data.jwt = await Sentc.refreshJwt(this.user_data.jwt, this.user_data.refresh_token);

			const storage = await Sentc.getStore();

			//save the user data with the new jwt
			await storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + this.userIdentifier, this.user_data);
		}

		return this.user_data.jwt;
	}

	public async updateUser(newIdentifier: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/user";

		const body = user_prepare_user_identifier_update(newIdentifier);

		const res = await make_req(HttpMethod.PUT, url, this.app_token, body, jwt);
		return handle_general_server_response(res);
	}

	public async resetPassword(newPassword: string)
	{
		//check if the user is logged in with a valid jwt and got the private keys

		const jwt = await this.getJwt();

		const decryptedPrivateKey = this.user_data.device.private_key;
		const decryptedSignKey = this.user_data.device.sign_key;

		return reset_password(
			this.base_url,
			this.app_token,
			jwt,
			newPassword,
			decryptedPrivateKey,
			decryptedSignKey
		);
	}

	public changePassword(oldPassword:string, newPassword:string)
	{
		return change_password(
			this.base_url,
			this.app_token,
			this.userIdentifier,
			oldPassword,
			newPassword
		);
	}

	public async logOut()
	{
		const storage = await Sentc.getStore();

		return storage.delete(USER_KEY_STORAGE_NAMES.userData + "_id_" + this.userIdentifier);
	}

	public async deleteUser(password: string)
	{
		await delete_user(
			this.base_url,
			this.app_token,
			this.userIdentifier,
			password
		);

		return this.logOut();
	}

	public async deleteDevice(password: string, device_id: string)
	{
		await delete_device(this.base_url, this.app_token, this.userIdentifier, password, device_id);

		if (device_id === this.user_data.device_id) {
			//only log the device out if it is the actual used device
			return this.logOut();
		}
	}

	//__________________________________________________________________________________________________________________

	public prepareRegisterDevice(server_output: string, page = 0)
	{
		const key_count = this.user_data.user_keys.length;

		const [key_string] = prepareKeys(this.user_data.user_keys, page);

		return prepare_register_device(server_output, key_string, key_count);
	}

	public async registerDevice(server_output: string)
	{
		const key_count = this.user_data.user_keys.length;
		const [key_string] = prepareKeys(this.user_data.user_keys);

		const jwt = await this.getJwt();

		const out = await register_device(this.base_url, this.app_token, jwt, server_output, key_count, key_string);
		const session_id = out.get_session_id();
		const public_key = out.get_public_key();

		if (session_id === "") {
			return;
		}

		let next_page = true;
		let i = 1;
		const p = [];

		while (next_page) {
			const next_keys = prepareKeys(this.user_data.user_keys, i);
			next_page = next_keys[1];

			p.push(user_device_key_session_upload(this.base_url, this.app_token, jwt, session_id, public_key, next_keys[0]));

			i++;
		}

		return Promise.allSettled(p);
	}

	public async getDevices(last_fetched_item: UserDeviceList | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.device_id ?? "none";


		const url = this.base_url + "/api/v1/user/device/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		const out: UserDeviceList[] = handle_server_response(res);

		return out;
	}

	//__________________________________________________________________________________________________________________

	public async keyRotation()
	{
		const jwt = await this.getJwt();

		const key_id = await user_key_rotation(this.base_url, this.app_token, jwt, this.user_data.device.public_key, this.getNewestKey().group_key);

		return this.fetchUserKey(key_id, true);
	}

	public async finishKeyRotation()
	{
		const jwt = await this.getJwt();

		let keys: GroupKeyRotationOut[] = await user_pre_done_key_rotation(this.base_url, this.app_token, jwt);

		let next_round = false;
		let rounds_left = 10;

		const public_key = this.user_data.device.public_key;
		const private_key = this.user_data.device.private_key;

		do {
			const left_keys = [];

			for (let i = 0; i < keys.length; i++) {
				const key = keys[i];

				let pre_key;

				try {
					// eslint-disable-next-line no-await-in-loop
					pre_key = await this.getUserKeys(key.pre_group_key_id);
				} catch (e) {
					//key not found, try next round
				}

				if (pre_key === undefined) {
					left_keys.push(key);
					continue;
				}

				// eslint-disable-next-line no-await-in-loop
				await user_finish_key_rotation(this.base_url, this.app_token, jwt, key.server_output, pre_key.group_key, public_key, private_key);

				// eslint-disable-next-line no-await-in-loop
				await this.getUserKeys(key.new_group_key_id, true);
			}

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
	}

	//__________________________________________________________________________________________________________________

	public async getGroups(last_fetched_item: GroupList | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/all/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		const out: GroupList[] = handle_server_response(res);

		return out;
	}

	public async getGroupInvites(last_fetched_item: GroupInviteListItem | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/invite/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		const out: GroupInviteListItem[] = handle_server_response(res);

		return out;
	}

	public async acceptGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + group_id + "/invite";
		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt);
		return handle_general_server_response(res);
	}

	public async rejectGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + group_id + "/invite";
		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt);
		return handle_general_server_response(res);
	}

	//join req
	public async groupJoinRequest(group_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/" + group_id + "/join_req";
		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, jwt);
		return handle_general_server_response(res);
	}

	public async sentJoinReq(last_fetched_item: GroupInviteListItem | null = null)
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/joins/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		const out: GroupInviteListItem[] = handle_server_response(res);

		return out;
	}

	public async deleteJoinReq(id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/group/joins/" + id;
		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt);
		return handle_general_server_response(res);
	}

	//__________________________________________________________________________________________________________________

	public prepareGroupCreate()
	{
		//important use the public key not the exported public key here!
		return group_prepare_create_group(this.getNewestPublicKey());
	}

	public async createGroup()
	{
		const jwt = await this.getJwt();

		return group_create_group(this.base_url, this.app_token, jwt, this.getNewestPublicKey(), "");
	}

	public getGroup(group_id: string, group_as_member = "")
	{
		return getGroup(group_id, this.base_url, this.app_token, this, false, group_as_member);
	}

	//__________________________________________________________________________________________________________________

	public prepareRegisterFile(file: File): Promise<FilePrepareCreateOutput>;

	public prepareRegisterFile(file: File, reply_id: string): Promise<FilePrepareCreateOutput>;

	public async prepareRegisterFile(file: File, reply_id = ""): Promise<FilePrepareCreateOutput>
	{
		const key = await this.registerKey(reply_id);

		reply_id = (reply_id !== "") ? reply_id : this.user_data.user_id;
		const other_user = (reply_id !== "") ? reply_id : undefined;

		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, other_user);

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
		const uploader = new Uploader(this.base_url, this.app_token, this);

		uploader.doneFileRegister(server_output);
	}

	public uploadFile(file: File, content_key: SymKey): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: true): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: false, upload_callback: (progress?: number) => void): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign: true, upload_callback: (progress?: number) => void): Promise<[string, string]>;

	public uploadFile(file: File, content_key: SymKey, sign = false, upload_callback?: (progress?: number) => void)
	{
		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, undefined, upload_callback);

		return uploader.uploadFile(file, content_key.key, content_key.master_key_id, sign);
	}

	//__________________________________________________________________________________________________________________

	public createFile(file: File): Promise<FileCreateOutput>;

	public createFile(file: File, sign: true): Promise<FileCreateOutput>;

	public createFile(file: File, sign: false, reply_id: string): Promise<FileCreateOutput>;

	public createFile(file: File, sign: true, reply_id: string): Promise<FileCreateOutput>;

	public createFile(file: File, sign: false, reply_id: string, upload_callback: (progress?: number) => void): Promise<FileCreateOutput>;

	public createFile(file: File, sign: true, reply_id: string, upload_callback: (progress?: number) => void): Promise<FileCreateOutput>;

	public async createFile(file: File, sign = false, reply_id = "", upload_callback?: (progress?: number) => void)
	{
		reply_id = (reply_id !== "") ? reply_id : this.user_data.user_id;
		const other_user = (reply_id !== "") ? reply_id : undefined;

		//1st register a new key for this file
		const key = await this.registerKey(reply_id);

		//2nd encrypt and upload the file, use the created key
		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, other_user, upload_callback);

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
		const downloader = new Downloader(this.base_url, this.app_token, this);

		//1. get the file info
		const file_meta = await downloader.downloadFileMetaInformation(file_id);

		//2. get the content key which was used to encrypt the file
		const key_id = file_meta.key_id;
		const key = await this.fetchGeneratedKey(key_id, file_meta.master_key_id);

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

	public async updateFileName(file_id: string, content_key: SymKey, file_name: string)
	{
		const jwt = await this.getJwt();

		return file_file_name_update(this.base_url, this.app_token, jwt, file_id, content_key.key, file_name);
	}

	public async deleteFile(file_id: string)
	{
		const jwt = await this.getJwt();

		return file_delete_file(this.base_url, this.app_token, jwt, file_id, "", "");
	}
}