import {AbstractAsymCrypto} from "./crypto/AbstractAsymCrypto";
import {
	FileCreateOutput,
	FileMetaInformation, FilePrepareCreateOutput,
	GroupInviteListItem,
	GroupList,
	USER_KEY_STORAGE_NAMES,
	UserData
} from "./Enities";
import {
	change_password, decode_jwt, delete_user, file_delete_file, file_file_name_update,
	group_accept_invite, group_create_group, group_get_groups_for_user,
	group_get_invites_for_user,
	group_join_req, group_prepare_create_group,
	group_reject_invite, reset_password,
	update_user
} from "sentc_wasm";
import {Sentc} from "./Sentc";
import {getGroup} from "./Group";
import {Downloader, Uploader} from "./file";
import {SymKey} from ".";

/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/20
 */

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

	getPrivateKey(): Promise<string>
	{
		return Promise.resolve(this.user_data.private_key);
	}

	async getPublicKey(reply_id: string): Promise<[string, string]>
	{
		const public_key = await Sentc.getUserPublicKeyData(this.base_url, this.app_token, reply_id);

		return [public_key.key, public_key.id];
	}

	getSignKey(): Promise<string>
	{
		return Promise.resolve(this.user_data.sign_key);
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

	public updateUser(newIdentifier: string)
	{
		return update_user(
			this.base_url,
			this.app_token,
			this.user_data.jwt,
			newIdentifier
		);
	}

	public async resetPassword(newPassword: string)
	{
		//check if the user is logged in with a valid jwt and got the private keys

		const jwt = await this.getJwt();

		const decryptedPrivateKey = this.user_data.private_key;
		const decryptedSignKey = this.user_data.sign_key;

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

	//__________________________________________________________________________________________________________________

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
			last_id
		);

		return out;
	}

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
			last_id
		);

		return out;
	}

	public async acceptGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		return group_accept_invite(
			this.base_url,
			this.app_token,
			jwt,
			group_id
		);
	}

	public async rejectGroupInvite(group_id: string)
	{
		const jwt = await this.getJwt();

		return group_reject_invite(
			this.base_url,
			this.app_token,
			jwt,
			group_id
		);
	}

	//join req
	public async groupJoinRequest(group_id: string)
	{
		const jwt = await this.getJwt();

		return group_join_req(
			this.base_url,
			this.app_token,
			jwt,
			group_id
		);
	}

	//__________________________________________________________________________________________________________________

	public prepareGroupCreate()
	{
		//important use the public key not the exported public key here!
		return group_prepare_create_group(this.user_data.public_key);
	}

	public async createGroup()
	{
		const jwt = await this.getJwt();

		return group_create_group(this.base_url, this.app_token, jwt, this.user_data.public_key);
	}

	public getGroup(group_id: string)
	{
		return getGroup(group_id, this.base_url, this.app_token, this);
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

		const [server_input, encrypted_file_name] =  uploader.prepareFileRegister(file, key.key);

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

		return uploader.uploadFile(file, content_key.key, sign);
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

		const [file_id, encrypted_file_name] = await uploader.uploadFile(file, key.key, sign);

		return {
			file_id,
			master_key_id: key.master_key_id,
			encrypted_file_name
		};
	}

	public downloadFile(file_id: string, master_key_id: string): Promise<[string, FileMetaInformation, SymKey]>;
	
	public downloadFile(file_id: string, master_key_id: string, verify_key: string): Promise<[string, FileMetaInformation, SymKey]>;

	public downloadFile(file_id: string, master_key_id: string, verify_key: string, updateProgressCb: (progress: number) => void): Promise<[string, FileMetaInformation, SymKey]>;

	public async downloadFile(file_id: string, master_key_id: string, verify_key = "", updateProgressCb?: (progress: number) => void)
	{
		const downloader = new Downloader(this.base_url, this.app_token, this);

		//1. get the file info
		const file_meta = await downloader.downloadFileMetaInformation(file_id);

		//2. get the content key which was used to encrypt the file
		const key_id = file_meta.key_id;
		const key = await this.fetchGeneratedKey(key_id, master_key_id);

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

		return file_delete_file(this.base_url, this.app_token, jwt, file_id, "");
	}
}