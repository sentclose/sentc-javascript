/**
 * The error representation
 *
 * The Error gets usually thrown as Error(String)
 * where the string is the json version of this interface
 */
export interface SentcError
{
	status: string,
	error_message: string
}

export type LoginUser<T> =
	| {kind: "user"; u: T}
	| {kind: "mfa"; u: UserMfaLogin};


export interface UserMfaLogin {
	deviceIdentifier: string,
	mfa_master_key: string,
	mfa_auth_key: string
}

export interface OtpRegister {
	secret: string,
	alg: string,
	recover: string[]
}

export interface OtpRecoveryKeysOutput {
	keys: string[]
}

export interface UserDeviceList
{
	device_id: string,
	time: number,
	device_identifier: string
}

export interface GroupInviteListItem
{
	group_id: string,
	time: number
}

export interface GroupList
{
	group_id: string,
	time: number,
	joined_time: number,
	rank: number,
	parent?: string
}

export interface GroupChildrenListItem {
	group_id: string,
	time: number,
	parent?: string
}

//______________________________________________________________________________________________________________________

export interface ServerOutput<T> {
	status: boolean,
	err_msg?: string,
	err_code?: number,
	result?: T
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const enum HttpMethod
{
	GET = "GET",
	POST = "POST",
	PUT = "PUT",
	PATCH = "PATCH",
	DELETE = "DELETE",
}
