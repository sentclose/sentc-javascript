import {SymKey} from "./crypto/SymKey";
import {LoginUser as CoreLoginUser} from "@sentclose/sentc-common";
import {User} from "./User";

type GeneralIdFormat = string;
export type UserId = GeneralIdFormat;

export const enum USER_KEY_STORAGE_NAMES
{
	userData = "user_data",
	actualUser = "actual_user",

	userPublicKey = "user_public_key",
	userVerifyKey = "user_verify_key",

	groupData = "group_data",
	groupPublicKey = "group_public_key",

	sym_key = "sym_key"
}

export type LoginUser = CoreLoginUser<User>;

export interface UserPublicKeyData {
	public_key: string,
	public_key_id: string,
	public_key_sig_key_id?: string,
	verified: boolean
}

export interface UserKeyData
{
	private_key: string,
	public_key: string,
	group_key: string,
	time: number,
	group_key_id: string,
	sign_key: string,
	verify_key: string,
	exported_public_key: string,
	exported_public_key_sig_key_id?: string,
	exported_verify_key: string,
}

export interface UserDeviceKeyData
{
	private_key:string,
	public_key: string,
	sign_key: string,
	verify_key: string,
	exported_public_key: string,
	exported_verify_key: string,
}

export interface UserData
{
	device: UserDeviceKeyData,
	user_keys: UserKeyData[],
	key_map: Map<string, number>,
	newest_key_id: string,
	mfa: boolean,

	jwt: string,
	refresh_token: string,
	user_id: string,
	device_id: string,
	hmac_keys: string[]	//the decrypted hmac key
}

export interface GroupKey {
	private_group_key: string,
	public_group_key: string,
	exported_public_key: string,
	group_key: string,
	time: string,
	group_key_id: string
}

export interface GroupOutDataKeys {
	private_key_id: string,
	key_data: string,
	signed_by_user_id?: string,
	signed_by_user_sign_key_id?: string
}

export interface GroupOutDataHmacKeys {
	group_key_id: string,
	key_data: string
}

export interface GroupOutDataSortableKeys {
	group_key_id: string,
	key_data: string
}

export interface GroupData
{
	group_id: string,
	parent_group_id?: string,
	from_parent: boolean,	//describe if this group was fetched by parent group or normal fetch
	rank: number,
	key_update:boolean,
	create_time: string,
	joined_time: string,
	keys: GroupKey[],
	key_map: Map<string, number>,	//save the index of the key to this key id
	newest_key_id: string,	//get the id of the newest group key
	access_by_parent_group: string | undefined,
	access_by_group_as_member?: string,
	is_connected_group: boolean,
	hmac_keys: string[],
	sortable_keys: string[],
	last_check_time: number,
}

export interface GroupJoinReqListItem
{
	user_id: string,
	time: number,
	user_type: number
}

export interface GroupKeyRotationOut
{
	pre_group_key_id: string,
	server_output: string,
	new_group_key_id: string,
	encrypted_eph_key_key_id: string,
}

export interface KeyRotationInput {
	error?: string,
	encrypted_ephemeral_key_by_group_key_and_public_key: string,
	encrypted_group_key_by_ephemeral: string,
	ephemeral_alg: string,
	encrypted_eph_key_key_id: string, //the public key id which was used to encrypt the eph key on the server.
	previous_group_key_id: string,
	time: string,
	new_group_key_id: string,
}

export interface GroupUserListItem {
	user_id: string,
	rank: number,
	joined_time: number,
	user_type: number
}

export interface KeyRotationStartServerOutput {
	group_id: string,
	key_id: string
}

export interface GroupDataCheckUpdateServerOutput
{
	key_update: boolean,
	rank: number
}

//______________________________________________________________________________________________________________________

export interface SignHead {
	id: string,
	alg: string
}

export interface CryptoHead {
	id: string,
	sign: SignHead | undefined
}

export interface CryptoRawOutput
{
	head: string,
	data: Uint8Array
}

//______________________________________________________________________________________________________________________

export interface PartListItem {
	part_id: string,
	sequence: number,
	extern_storage: boolean
}

export interface FileMetaFetched {
	file_id: string,
	master_key_id: string,
	belongs_to?: string,
	belongs_to_type: any,
	key_id: string,
	part_list: PartListItem[],
	encrypted_file_name?: string,
	encrypted_key: string,
	encrypted_key_alg: string,
}

export interface FileMetaInformation {
	file_id: string,
	master_key_id: string,
	belongs_to?: string,
	belongs_to_type: any,
	encrypted_key: string,
	encrypted_key_alg: string,
	part_list: PartListItem[],
	file_name?: string,
	encrypted_file_name?: string
}

export interface FilePrepareCreateOutput
{
	server_input: string,
	master_key_id: string,
	encrypted_file_name: string,
	key: SymKey
}

export interface FileCreateOutput
{
	file_id: string,
	master_key_id: string,
	encrypted_file_name: string
}
