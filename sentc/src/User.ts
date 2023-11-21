import {AbstractAsymCrypto} from "./crypto/AbstractAsymCrypto";
import {
	FileCreateOutput,
	FileMetaInformation,
	FilePrepareCreateOutput,
	GroupKeyRotationOut,
	GroupOutDataHmacKeys,
	USER_KEY_STORAGE_NAMES,
	UserData,
	UserKeyData,
	UserPublicKeyData
} from "./Enities";
import {
	change_password,
	decode_jwt,
	delete_device,
	delete_user,
	done_fetch_user_key,
	file_prepare_file_name_update,
	get_fresh_jwt,
	group_create_group,
	group_decrypt_hmac_key,
	group_prepare_create_group,
	prepare_register_device,
	register_device,
	reset_password,
	user_create_safety_number,
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
import {
	create_error,
	GroupInviteListItem,
	GroupList,
	handle_general_server_response,
	handle_server_response,
	HttpMethod,
	make_req,
	OtpRecoveryKeysOutput,
	OtpRegister,
	UserDeviceList
} from "@sentclose/sentc-common";

async function setUserStorageData(user_data: UserData, deviceIdentifier: string) {
	const storage = await Sentc.getStore();

	const store_user_data = user_data;

	if (Sentc.options.refresh.endpoint !== REFRESH_ENDPOINT.api) {
		//if the refresh token should not be stored on the client -> invalidates the stored refresh token
		//but just return the refresh token with the rest of the user data
		store_user_data.refresh_token = "";
	}

	return storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + deviceIdentifier, store_user_data);
}

export async function getUser(deviceIdentifier: string, user_data: UserData, encrypted_hmac_keys: GroupOutDataHmacKeys[] = [])
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
	const decrypted_hmac_keys = await user.decryptHmacKeys(encrypted_hmac_keys);
	user.user_data.hmac_keys = decrypted_hmac_keys;
	store_user_data.hmac_keys = decrypted_hmac_keys;

	//save user data in indexeddb
	const storage = await Sentc.getStore();

	await Promise.all([
		storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + deviceIdentifier, store_user_data),
		storage.set(USER_KEY_STORAGE_NAMES.actualUser, deviceIdentifier),
		//save always the newest public key
		storage.set(USER_KEY_STORAGE_NAMES.userPublicKey + "_id_" + user_data.user_id, <UserPublicKeyData>{
			public_key: user_data.user_keys[0].exported_public_key,
			public_key_id: user_data.user_keys[0].group_key_id,
			public_key_sig_key_id: user_data.user_keys[0].exported_public_key_sig_key_id,
			verified: false
		}),
		storage.set(
			USER_KEY_STORAGE_NAMES.userVerifyKey + "_id_" + user_data.user_id + "_key_id_" + user_data.user_keys[0].group_key_id,
			user_data.user_keys[0].exported_verify_key
		)
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

	private getUserKeysSync(key_id: string)
	{
		const index = this.user_data.key_map.get(key_id);

		if (index === undefined) {
			throw new Error("Key not found");
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

	getPrivateKeySync(key_id: string): string
	{
		const key = this.getUserKeysSync(key_id);

		return key.private_key;
	}

	getPublicKey(reply_id: string): Promise<UserPublicKeyData>
	{
		return Sentc.getUserPublicKeyData(this.base_url, this.app_token, reply_id);
	}

	getNewestHmacKey(): string
	{
		return this.user_data.hmac_keys[0];
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

	getSignKeySync(): string
	{
		return this.getNewestSignKey();
	}

	public enabledMfa(): boolean
	{
		return this.user_data.mfa;
	}

	public async decryptHmacKeys(fetchedKeys: GroupOutDataHmacKeys[])
	{
		const keys: string[] = [];

		for (let i = 0; i < fetchedKeys.length; i++) {
			const fetched_key = fetchedKeys[i];

			// eslint-disable-next-line no-await-in-loop
			const group_key = await this.getUserSymKey(fetched_key.group_key_id);

			const decrypted_hmac_key = group_decrypt_hmac_key(group_key, fetched_key.key_data);

			keys.push(decrypted_hmac_key);
		}

		return keys;
	}

	public async fetchUserKey(key_id: string, first = false)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/user/user_keys/key/" + key_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		const fetched_keys = done_fetch_user_key(this.user_data.device.private_key, res);
		
		const user_keys: UserKeyData = {
			exported_verify_key: fetched_keys.get_exported_verify_key(),
			group_key_id: fetched_keys.get_group_key_id(),
			verify_key: fetched_keys.get_verify_key(),
			time: +fetched_keys.get_time(),
			sign_key: fetched_keys.get_sign_key(),
			public_key: fetched_keys.get_public_key(),
			exported_public_key_sig_key_id: fetched_keys.get_exported_public_key_sig_key_id(),
			exported_public_key: fetched_keys.get_exported_public_key(),
			group_key: fetched_keys.get_group_key(),
			private_key: fetched_keys.get_private_key()
		};

		const index = this.user_data.user_keys.length;
		this.user_data.user_keys.push(user_keys);

		this.user_data.key_map.set(user_keys.group_key_id, index);
		
		if (first) {
			this.user_data.newest_key_id = user_keys.group_key_id;
		}
		
		return setUserStorageData(this.user_data, this.userIdentifier);
	}

	public async getJwt()
	{
		const jwt_data = decode_jwt(this.user_data.jwt);

		const exp = jwt_data.get_exp();

		if (exp <= Date.now() / 1000 + 30) {
			//refresh even when the jwt is valid for 30 sec
			//update the user data to safe the updated values, we don't need the class here
			this.user_data.jwt = await Sentc.refreshJwt(this.user_data.jwt, this.user_data.refresh_token);

			//save the user data with the new jwt
			await setUserStorageData(this.user_data, this.userIdentifier);
		}

		return this.user_data.jwt;
	}

	private getFreshJwt(username: string, password: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		return get_fresh_jwt(this.base_url, this.app_token, username, password, mfa_token, mfa_recovery);
	}

	public async updateUser(newIdentifier: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/user";

		const body = user_prepare_user_identifier_update(newIdentifier);

		const res = await make_req(HttpMethod.PUT, url, this.app_token, body, jwt);
		return handle_general_server_response(res);
	}

	public async registerRawOtp(password: string, mfa_token?: string, mfa_recovery?: boolean): Promise<OtpRegister>
	{
		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);
		const url = this.base_url + "/api/v1/user/register_otp";

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, fresh_jwt);

		this.user_data.mfa = true;

		await setUserStorageData(this.user_data, this.userIdentifier);

		return handle_server_response(res);
	}

	public async registerOtp(issuer: string, audience: string, password: string, mfa_token?: string, mfa_recovery?: boolean): Promise<[string, string[]]>
	{
		const out = await this.registerRawOtp(password, mfa_token, mfa_recovery);

		return [`otpauth://totp/${issuer}:${audience}?secret=${out.secret}&algorithm=SHA256&issuer=${issuer}`, out.recover];
	}

	public async getOtpRecoverKeys(password: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);
		const url = this.base_url + "/api/v1/user/otp_recovery_keys";

		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, fresh_jwt);

		return handle_server_response<OtpRecoveryKeysOutput>(res).keys;
	}

	public async resetRawOtp(password: string, mfa_token?: string, mfa_recovery?: boolean): Promise<OtpRegister>
	{
		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);
		const url = this.base_url + "/api/v1/user/reset_otp";

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, fresh_jwt);

		return handle_server_response(res);
	}

	public async resetOtp(issuer: string, audience: string, password: string, mfa_token?: string, mfa_recovery?: boolean): Promise<[string, string[]]>
	{
		const out = await this.resetRawOtp(password, mfa_token, mfa_recovery);

		return [`otpauth://totp/${issuer}:${audience}?secret=${out.secret}&algorithm=SHA256&issuer=${issuer}`, out.recover];
	}

	public async disableOtp(password: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);
		const url = this.base_url + "/api/v1/user/disable_otp";

		const res = await make_req(HttpMethod.PATCH, url, this.app_token, undefined, fresh_jwt);

		handle_general_server_response(res);

		this.user_data.mfa = false;
		return setUserStorageData(this.user_data, this.userIdentifier);
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

	public changePassword(oldPassword:string, newPassword:string, mfa_token?: string, mfa_recovery?: boolean)
	{
		if (this.user_data.mfa && !mfa_token) {
			throw create_error("client_10000", "The user enabled mfa. To change the password, the user must also enter the mfa token");
		}

		return change_password(
			this.base_url,
			this.app_token,
			this.userIdentifier,
			oldPassword,
			newPassword,
			mfa_token,
			mfa_recovery
		);
	}

	public async logOut()
	{
		const storage = await Sentc.getStore();

		return storage.delete(USER_KEY_STORAGE_NAMES.userData + "_id_" + this.userIdentifier);
	}

	public async deleteUser(password: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		if (this.user_data.mfa && !mfa_token) {
			throw create_error("client_10000", "The user enabled mfa. To delete the user, the user must also enter the mfa token");
		}

		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);

		await delete_user(this.base_url, this.app_token, fresh_jwt);

		return this.logOut();
	}

	public async deleteDevice(password: string, device_id: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		if (this.user_data.mfa && !mfa_token) {
			throw create_error("client_10000", "The user enabled mfa. To delete a device, the user must also enter the mfa token");
		}

		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);

		await delete_device(this.base_url, this.app_token, fresh_jwt, device_id);

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

	public async getDevices(last_fetched_item: UserDeviceList | null = null): Promise<UserDeviceList[]>
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.device_id ?? "none";


		const url = this.base_url + "/api/v1/user/device/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		return handle_server_response(res);
	}

	public async createSafetyNumber(user_to_compare?: {user_id: string, verify_key_id: string})
	{
		let verify_key_2: string | undefined;

		if (user_to_compare) {
			verify_key_2 = await Sentc.getUserVerifyKeyData(this.base_url, this.app_token, user_to_compare.user_id, user_to_compare.verify_key_id);
		}

		return user_create_safety_number(this.getNewestKey().exported_verify_key, this.user_data.user_id, verify_key_2, user_to_compare?.user_id);
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

	public async getGroups(last_fetched_item: GroupList | null = null): Promise<GroupList[]>
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/all/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		return handle_server_response(res);
	}

	public async getGroupInvites(last_fetched_item: GroupInviteListItem | null = null): Promise<GroupInviteListItem[]>
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/invite/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		return handle_server_response(res);
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

	public async sentJoinReq(last_fetched_item: GroupInviteListItem | null = null): Promise<GroupInviteListItem[]>
	{
		const jwt = await this.getJwt();

		const last_fetched_time = last_fetched_item?.time.toString() ?? "0";
		const last_id = last_fetched_item?.group_id ?? "none";

		const url = this.base_url + "/api/v1/group/joins/" + last_fetched_time + "/" + last_id;
		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt);

		return handle_server_response(res);
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

		return group_create_group(this.base_url, this.app_token, jwt, this.getNewestPublicKey());
	}

	public getGroup(group_id: string, group_as_member?: string)
	{
		return getGroup(group_id, this.base_url, this.app_token, this, false, group_as_member);
	}

	//__________________________________________________________________________________________________________________

	/**
	 * Prepare the register of a file. The server input could be passed to the sentc api from your backend
	 *
	 * encrypted_file_name, key and master_key_id are only for the frontend to encrypt more data if necessary
	 *
	 * @param file
	 * @throws SentcError
	 */
	public prepareRegisterFile(file: File): Promise<FilePrepareCreateOutput>;

	/**
	 * Prepare the register of a file. The server input could be passed to the sentc api from your backend
	 *
	 * encrypted_file_name, key and master_key_id are only for the frontend to encrypt more data if necessary
	 *
	 * this file is registered for another user to open it
	 *
	 * @param file
	 * @param reply_id
	 * @throws SentcError
	 */
	public prepareRegisterFile(file: File, reply_id: string): Promise<FilePrepareCreateOutput>;

	public async prepareRegisterFile(file: File, reply_id = ""): Promise<FilePrepareCreateOutput>
	{
		const [key, encrypted_key] = await this.generateNonRegisteredKey(reply_id);
		
		reply_id = (reply_id !== "") ? reply_id : this.user_data.user_id;
		const other_user = (reply_id !== "") ? reply_id : undefined;

		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, other_user);

		const [server_input, encrypted_file_name] =  uploader.prepareFileRegister(
			file,
			key.key,
			encrypted_key,
			key.master_key_id
		);

		return {
			server_input,
			encrypted_file_name,
			key,
			master_key_id: key.master_key_id
		};
	}

	/**
	 * Validates the sentc file register output
	 * Returns the file id
	 *
	 * @param server_output
	 */
	public doneFileRegister(server_output: string)
	{
		const uploader = new Uploader(this.base_url, this.app_token, this);

		return uploader.doneFileRegister(server_output);
	}

	/**
	 * Upload a registered file.
	 * Session id is returned from the sentc api. The rest from @prepareRegisterFile
	 *
	 * @param file
	 * @param content_key
	 * @param session_id
	 */
	public uploadFile(file: File, content_key: SymKey, session_id: string): Promise<void>;

	/**
	 * Upload a registered file.
	 * Session id is returned from the sentc api. The rest from @prepareRegisterFile
	 * upload the chunks signed by the creators sign key
	 *
	 * @param file
	 * @param content_key
	 * @param session_id
	 * @param sign
	 */
	public uploadFile(file: File, content_key: SymKey, session_id: string, sign: true): Promise<void>;

	/**
	 * Upload a registered file.
	 * Session id is returned from the sentc api. The rest from @prepareRegisterFile
	 * optional upload the chunks signed by the creators sign key
	 * Show the upload progress of how many chunks are already uploaded
	 *
	 * @param file
	 * @param content_key
	 * @param session_id
	 * @param sign
	 * @param upload_callback
	 */
	public uploadFile(file: File, content_key: SymKey, session_id: string, sign: boolean, upload_callback: (progress?: number) => void): Promise<void>;

	public uploadFile(file: File, content_key: SymKey, session_id: string, sign = false, upload_callback?: (progress?: number) => void)
	{
		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, undefined, upload_callback);

		return uploader.checkFileUpload(file, content_key.key, session_id, sign);
	}

	private async getFileMetaInfo(file_id: string, downloader: Downloader, verify_key?: string): Promise<[FileMetaInformation, SymKey]>
	{
		//1. get the file info
		const file_meta = await downloader.downloadFileMetaInformation(file_id);

		//2. get the content key which was used to encrypt the file
		const key = await this.getNonRegisteredKey(
			file_meta.master_key_id,
			file_meta.encrypted_key
		);

		//3. get the file name if any
		if (file_meta.encrypted_file_name && file_meta.encrypted_file_name !== "") {
			file_meta.file_name = key.decryptString(file_meta.encrypted_file_name, verify_key);
		}

		return [file_meta, key];
	}

	/**
	 * Get the FileMetaInformation which contains all Information about the file
	 * Return also the file key back.
	 *
	 * This function can be used if the user needs the decrypted file name.
	 *
	 * @param file_id
	 */
	public downloadFileMetaInfo(file_id: string): Promise<[FileMetaInformation, SymKey]>;

	/**
	 * The same but with a verify key
	 *
	 * @param file_id
	 * @param verify_key
	 */
	public downloadFileMetaInfo(file_id: string, verify_key: string): Promise<[FileMetaInformation, SymKey]>;

	public downloadFileMetaInfo(file_id: string, verify_key?: string)
	{
		const downloader = new Downloader(this.base_url, this.app_token, this);

		return this.getFileMetaInfo(file_id, downloader, verify_key);
	}

	/**
	 * Download a file but with already downloaded file information and
	 * the file key to not fetch the info and the key again.
	 *
	 * This function can be used after the downloadFileMetaInfo function
	 *
	 * @param key
	 * @param file_meta
	 */
	public downloadFileWithMetaInfo(key: SymKey, file_meta: FileMetaInformation): Promise<string>;

	/**
	 * The same but with a verify key to verify each file part
	 *
	 * @param key
	 * @param file_meta
	 * @param verify_key
	 */
	public downloadFileWithMetaInfo(key: SymKey, file_meta: FileMetaInformation, verify_key: string): Promise<string>;

	/**
	 * The same but with optional verify key and a function to show the download progress
	 *
	 * @param key
	 * @param file_meta
	 * @param verify_key
	 * @param updateProgressCb
	 */
	public downloadFileWithMetaInfo(key: SymKey, file_meta: FileMetaInformation, verify_key: string, updateProgressCb: (progress: number) => void): Promise<string>;

	public downloadFileWithMetaInfo(key: SymKey, file_meta: FileMetaInformation, verify_key?: string, updateProgressCb?: (progress: number) => void)
	{
		const downloader = new Downloader(this.base_url, this.app_token, this);

		return downloader.downloadFileParts(file_meta.part_list, key.key, updateProgressCb, verify_key);
	}

	//__________________________________________________________________________________________________________________

	/**
	 * Register and upload a file to the sentc api.
	 * The file will be encrypted
	 *
	 * @param file
	 */
	public createFile(file: File): Promise<FileCreateOutput>;

	/**
	 * Create a file and sign each file part with the sign key of the creator
	 *
	 * @param file
	 * @param sign
	 */
	public createFile(file: File, sign: true): Promise<FileCreateOutput>;

	public createFile(file: File, sign: boolean, reply_id: string): Promise<FileCreateOutput>;

	/**
	 * The same but with optional signing and a function to show the upload progress
	 *
	 * @param file
	 * @param sign
	 * @param reply_id
	 * @param upload_callback
	 */
	public createFile(file: File, sign: boolean, reply_id: string, upload_callback: (progress?: number) => void): Promise<FileCreateOutput>;

	public async createFile(file: File, sign = false, reply_id = "", upload_callback?: (progress?: number) => void)
	{
		reply_id = (reply_id !== "") ? reply_id : this.user_data.user_id;
		const other_user = (reply_id !== "") ? reply_id : undefined;

		//1st register a new key for this file
		const [key, encrypted_key] = await this.generateNonRegisteredKey(reply_id);

		//2nd encrypt and upload the file, use the created key
		const uploader = new Uploader(this.base_url, this.app_token, this, undefined, other_user, upload_callback);

		const [file_id, encrypted_file_name] = await uploader.uploadFile(
			file,
			key.key,
			encrypted_key,
			key.master_key_id,
			sign
		);

		return {
			file_id,
			master_key_id: key.master_key_id,
			encrypted_file_name
		};
	}

	/**
	 * Download a file. THis function will also download the file meta information before
	 *
	 * @param file_id
	 */
	public downloadFile(file_id: string): Promise<[string, FileMetaInformation, SymKey]>;

	/**
	 * The same but with a verify key of the file creator
	 *
	 * @param file_id
	 * @param verify_key
	 */
	public downloadFile(file_id: string, verify_key: string): Promise<[string, FileMetaInformation, SymKey]>;

	/**
	 * The same but with an optional verify key and a function to show the download progress
	 *
	 * @param file_id
	 * @param verify_key
	 * @param updateProgressCb
	 */
	public downloadFile(file_id: string, verify_key: string, updateProgressCb: (progress: number) => void): Promise<[string, FileMetaInformation, SymKey]>;

	public async downloadFile(file_id: string, verify_key?: string, updateProgressCb?: (progress: number) => void)
	{
		const downloader = new Downloader(this.base_url, this.app_token, this);

		const [file_meta, key] = await this.getFileMetaInfo(file_id, downloader, verify_key);

		const url = await downloader.downloadFileParts(file_meta.part_list, key.key, updateProgressCb, verify_key);

		return [
			url,
			file_meta,
			key
		];
	}

	public async updateFileName(file_id: string, content_key: SymKey, file_name?: string)
	{
		const jwt = await this.getJwt();

		const body = file_prepare_file_name_update(content_key.key, file_name);

		const url = `${this.base_url}/api/v1/file/${file_id}`;

		const res = await make_req(HttpMethod.PUT, url, this.app_token, body, jwt);

		return handle_general_server_response(res);
	}

	public async deleteFile(file_id: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/file/" + file_id;

		const res = await make_req(HttpMethod.DELETE, url, this.app_token, undefined, jwt);

		return handle_general_server_response(res);
	}
}