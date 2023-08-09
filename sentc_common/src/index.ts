import {HttpMethod, ServerOutput, StorageOptions} from "./Entities";
import {ResCallBack, StorageFactory} from "./FileStorage";

export * from "./Entities";
export * from "./FileStorage";

/**
 *
 * @param res
 * @throws Error
 * When json parsed failed or server returns an error
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function handle_server_response<T>(res: string)
{
	let server_output: ServerOutput<T>;

	try {
		server_output = JSON.parse(res);
	} catch (e) {
		throw create_error("client_101", e?.message ?? "Cannot create an object from the input string");
	}

	if (!server_output.status) {
		if (!server_output?.err_code) {
			throw create_error("client_101", "Cannot create an object from the input string");
		}

		if (!server_output?.err_msg) {
			throw create_error("client_101", "Cannot create an object from the input string");
		}

		throw create_error("server_" + server_output.err_code, server_output.err_msg);
	}

	if (!server_output.result) {
		throw create_error("client_101", "Cannot create an object from the input string");
	}

	return server_output.result;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function handle_general_server_response(res: string) {
	handle_server_response<string>(res);
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function create_error(status: string, msg: string)
{
	return `{"status": "${status}", "error_message": "${msg}"}`;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export async function make_req(
	method: HttpMethod,
	url: string,
	auth_token: string,
	body?: string,
	jwt?: string,
	group_as_member?: string
) {
	const headers: {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"Authorization"?: string,
		"x-sentc-group-access-id"?: string,
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"Content-Type": string,
		"x-sentc-app-token": string
	} = {
		"Content-Type": "application/json",
		"x-sentc-app-token": auth_token
	};

	if (jwt) {
		headers["Authorization"] = "Bearer " + jwt;
	}

	if (group_as_member) {
		headers["x-sentc-group-access-id"] = group_as_member;
	}

	let res: Response;

	try {
		res = await fetch(url, {
			method,
			mode: "cors",
			headers,
			body
		});
	} catch (e) {
		throw create_error("client_1000", `Can't send the request: ${e?.message ?? "Request failed"}`);
	}

	try {
		return await res.text();
	} catch (e) {
		throw create_error("client_1002", `Can't decode the response to text: ${e?.message ?? "Request failed"}`);
	}
}

export async function getStorage(options?: StorageOptions)
{
	if (options?.getStorage) {
		this.storage = await options.getStorage();

		this.init_storage = true;

		return this.storage;
	}

	let errCallBack: ResCallBack;

	if (options?.default_storage) {
		errCallBack = options?.default_storage.errCallBack;
	} else {
		errCallBack = ({err, warn}) => {
			console.error(err);
			console.warn(warn);
		};
	}

	return StorageFactory.getStorage(errCallBack, "sentclose", "keys");
}