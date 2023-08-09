import {User} from "./User";
import {LoginUser as CoreLoginUser} from "@sentclose/sentc-common";

type GeneralIdFormat = string;
export type UserId = GeneralIdFormat;

export const enum USER_KEY_STORAGE_NAMES
{
	userData = "user_data",
	actualUser = "actual_user",

	groupData = "group_data",
}

export type LoginUser = CoreLoginUser<User>;


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

	jwt: string,
	refresh_token: string,
	user_id: string,
	device_id: string,
	mfa: boolean,
}

export interface GroupData
{
	group_id: string,
	parent_group_id?: string,
	from_parent: boolean,	//describe if this group was fetched by parent group or normal fetch
	rank: number,
	create_time: string,
	joined_time: string,
	access_by_parent_group: string | undefined,
	access_by_group_as_member?: string,
	is_connected_group: boolean,
	last_check_time: number,
}

export interface GroupDataCheckUpdateServerOutput
{
	rank: number
}
export interface GroupUserListItem {
	user_id: string,
	rank: number,
	joined_time: number,
	user_type: number
}

export interface GroupJoinReqListItem
{
	user_id: string,
	time: number,
	user_type: number
}

