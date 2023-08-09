/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2023/07/23
 */
import {
	USER_KEY_STORAGE_NAMES,
	UserData
} from "./Entities";
import {
	change_password,
	decode_jwt,
	delete_device,
	delete_user, get_fresh_jwt, group_create_group, register_device,
	user_prepare_user_identifier_update
} from "sentc_wasm_light";
import {REFRESH_ENDPOINT, Sentc} from "./Sentc";
import {create_error, handle_general_server_response, handle_server_response, make_req, GroupInviteListItem,
	GroupList,
	HttpMethod, OtpRecoveryKeysOutput,
	OtpRegister, UserDeviceList} from "@sentclose/sentc-common";
import {getGroup} from "./Group";

export async function getUser(deviceIdentifier: string, user_data: UserData)
{
	//Only fetch the older keys when needed, this is not like a group where all keys must be available
	
	const store_user_data = user_data;

	if (Sentc.options.refresh.endpoint !== REFRESH_ENDPOINT.api) {
		//if the refresh token should not be stored on the client -> invalidates the stored refresh token
		//but just return the refresh token with the rest of the user data
		store_user_data.refresh_token = "";
	}

	const user = new User(Sentc.options.base_url, Sentc.options.app_token, user_data, deviceIdentifier);

	//save user data in indexeddb
	const storage = await Sentc.getStore();

	await Promise.all([
		storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + deviceIdentifier, store_user_data),
		storage.set(USER_KEY_STORAGE_NAMES.actualUser, deviceIdentifier)
	]);

	return user;
}

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

export class User
{
	constructor(
		private base_url: string,
		private app_token: string,
		public user_data: UserData,
		private userIdentifier: string,
		public group_invites: GroupInviteListItem[] = []
	) {
	}

	public enabledMfa(): boolean
	{
		return this.user_data.mfa;
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

	public async updateUser(newIdentifier: string)
	{
		const jwt = await this.getJwt();

		const url = this.base_url + "/api/v1/user";

		const body = user_prepare_user_identifier_update(newIdentifier);

		const res = await make_req(HttpMethod.PUT, url, this.app_token, body, jwt);
		return handle_general_server_response(res);
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
			throw create_error("client_10000", "The user enabled mfa. To delete the user, the user must also enter the mfa token");
		}

		const fresh_jwt = await this.getFreshJwt(this.userIdentifier, password, mfa_token, mfa_recovery);

		await delete_device(this.base_url, this.app_token, fresh_jwt, device_id);

		if (device_id === this.user_data.device_id) {
			//only log the device out if it is the actual used device
			return this.logOut();
		}
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

	//__________________________________________________________________________________________________________________

	public async registerDevice(server_output: string)
	{
		const jwt = await this.getJwt();

		return register_device(this.base_url, this.app_token, jwt, server_output);
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

	public async createGroup()
	{
		const jwt = await this.getJwt();

		return group_create_group(this.base_url, this.app_token, jwt);
	}

	public getGroup(group_id: string, group_as_member?: string)
	{
		return getGroup(group_id, this.base_url, this.app_token, this, false, group_as_member);
	}

	//__________________________________________________________________________________________________________________
	//Otp

	private getFreshJwt(username: string, password: string, mfa_token?: string, mfa_recovery?: boolean)
	{
		return get_fresh_jwt(this.base_url, this.app_token, username, password, mfa_token, mfa_recovery);
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
}