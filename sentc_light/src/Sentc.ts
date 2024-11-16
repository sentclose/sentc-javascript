/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2023/07/23
 */
import {User, getUser} from "./User";
import init, {
	init_user,
	InitInput,
	refresh_jwt,
	login,
	prepare_check_user_identifier_available,
	done_check_user_identifier_available,
	generate_user_register_data,
	prepare_register, done_register,
	register, done_register_device_start, register_device_start,
	UserDataExport as WasmUserData, mfa_login,
	UserLoginOut as WasmUserLoginOut
} from "sentc_wasm_light";
import {
	create_error,
	make_req,
	StorageInterface,
	HttpMethod,
	UserMfaLogin,
	StorageOptions, getStorage
} from "@sentclose/sentc-common";
import {
	LoginUser,
	USER_KEY_STORAGE_NAMES,
	UserData,
	UserDeviceKeyData,
	UserId
} from "./Entities";

export const enum REFRESH_ENDPOINT {
	cookie,
	cookie_fn,
	api
}

export interface RefreshOptions {
	endpoint_url?: string,
	endpoint_fn?: (old_jwt: string) => Promise<string>,
	endpoint: REFRESH_ENDPOINT
}

export interface SentcOptions {
	base_url?: string,
	app_token: string,
	file_part_url?: string,
	refresh?: RefreshOptions,
	wasm_path?: InitInput | Promise<InitInput>,
	storage?: StorageOptions,
}

export class Sentc
{
	private static init_client = false;

	private static init_storage = false;

	//@ts-ignore
	public static options: SentcOptions = {};

	private static storage: StorageInterface;

	public static async getStore()
	{
		//only init when needed
		if (this.init_storage) {
			//dont init again
			return this.storage;
		}

		this.storage = await getStorage(this.options?.storage);

		this.init_storage = true;

		return this.storage;
	}

	public static async init(options: SentcOptions): Promise<User | undefined>
	{
		if (this.init_client) {
			try {
				return await this.getActualUser(true);
			} catch (e) {
				//user was not logged in but the client was init
				return;
			}
		}

		await init(options.wasm_path);

		const base_url = options?.base_url ?? "https://api.sentc.com";

		const refresh: RefreshOptions = options?.refresh ?? {
			endpoint: REFRESH_ENDPOINT.api,
			endpoint_url: base_url + "/api/v1/refresh"
		};

		Sentc.options = {
			base_url,
			app_token: options?.app_token,
			refresh,
			file_part_url: options?.file_part_url,
			storage: options?.storage
		};

		try {
			const [user, username] = await this.getActualUser(false, true);

			if (refresh?.endpoint === REFRESH_ENDPOINT.api) {
				//if refresh over api -> then do the init
				const out = await init_user(options.base_url, options.app_token, user.user_data.jwt, user.user_data.refresh_token);

				//save the invites if we fetched them from init request
				user.user_data.jwt = out.get_jwt();
				user.group_invites = out.get_invites();
			} else {
				//if refresh over cookie -> do normal refresh jwt
				await user.getJwt();
			}

			const storage = await this.getStore();

			//save the user data with the new jwt
			await storage.set(USER_KEY_STORAGE_NAMES.userData + "_id_" + username, user.user_data);

			this.init_client = true;

			return user;
		} catch (e) {
			//user was not logged in -> do nothing
			this.init_client = true;
		}
	}

	/**
	 * Do a request to the sentc api to check if the user identifier is still available.
	 *
	 * true => user identifier is free
	 *
	 * @param userIdentifier
	 */
	public static async checkUserIdentifierAvailable(userIdentifier: string)
	{
		const body = this.prepareCheckUserIdentifierAvailable(userIdentifier);

		if (!body) {
			return false;
		}

		const url = `${Sentc.options.base_url}/api/v1/exists`;
		const res = await make_req(HttpMethod.POST, url, Sentc.options.app_token, body);

		return this.doneCheckUserIdentifierAvailable(res);
	}

	/**
	 * Prepare the server input for the sentc api to check if an identifier is available
	 *
	 * This function won't do a request
	 *
	 * @param userIdentifier
	 */
	public static prepareCheckUserIdentifierAvailable(userIdentifier: string)
	{
		if (userIdentifier === "") {
			return false;
		}

		return prepare_check_user_identifier_available(userIdentifier);
	}

	/**
	 * Checks the server output after the request.
	 *
	 * This is only needed when not using @see checkUserIdentifierAvailable
	 *
	 * @param serverOutput
	 */
	public static doneCheckUserIdentifierAvailable(serverOutput: string)
	{
		return done_check_user_identifier_available(serverOutput);
	}

	public static generateRegisterData()
	{
		const out = generate_user_register_data();

		return [
			out.get_identifier(),
			out.get_password()
		];
	}

	/**
	 * Generates the register input for the api.
	 *
	 * It can be used in an external backend
	 *
	 * @param userIdentifier
	 * @param password
	 */
	public static prepareRegister(userIdentifier: string, password: string)
	{
		return prepare_register(userIdentifier, password);
	}

	/**
	 * Validates the register output from the api when using prepare register function
	 *
	 * @param serverOutput
	 */
	public static doneRegister(serverOutput: string)
	{
		return done_register(serverOutput);
	}

	/**
	 * Register a new user.
	 *
	 * @param userIdentifier
	 * @param password
	 * @throws Error
	 * - if username exists
	 * - request error
	 */
	public static register(userIdentifier: string, password: string): Promise<UserId> | false
	{
		if (userIdentifier === "" || password === "") {
			return false;
		}

		return register(Sentc.options.base_url, Sentc.options.app_token, userIdentifier, password);
	}

	public static doneRegisterDeviceStart(server_output: string)
	{
		return done_register_device_start(server_output);
	}

	public static registerDeviceStart(device_identifier: string, password: string)
	{
		if (device_identifier === "" || password === "") {
			return false;
		}

		return register_device_start(Sentc.options.base_url, Sentc.options.app_token, device_identifier, password);
	}

	//__________________________________________________________________________________________________________________

	private static buildUserObj(deviceIdentifier: string, out: WasmUserData | WasmUserLoginOut, mfa: boolean)
	{
		const device: UserDeviceKeyData = {
			private_key: out.get_device_private_key(),
			public_key: out.get_device_public_key(),
			sign_key: out.get_device_sign_key(),
			verify_key: out.get_device_verify_key(),
			exported_public_key: out.get_device_exported_public_key(),
			exported_verify_key: out.get_device_exported_verify_key()
		};

		const user_data: UserData = {
			device,
			jwt: out.get_jwt(),
			refresh_token: out.get_refresh_token(),
			user_id: out.get_id(),
			device_id: out.get_device_id(),
			mfa
		};

		return getUser(deviceIdentifier, user_data);
	}

	/**
	 * Log the user in
	 *
	 * Store all user data in the storage (e.g. Indexeddb)
	 *
	 * For a refresh token flow -> send the refresh token to your server and save it in a http only strict cookie
	 * Then the user is safe for xss and csrf attacks
	 *
	 * when Either UserMfaLogin is returned, then the user must enter the mfa token.
	 * Use the function Sentc.mfaLogin() to do the totp login or Sentc.mfaRecoveryLogin() to log in with a recover key
	 */
	public static async login(deviceIdentifier: string, password: string): Promise<LoginUser>;

	/**
	 * Log in the user.
	 *
	 * The same as the other login function but already given the user class back instead of an Either type.
	 * This is helpful if you disabled mfa for every user and just wants to get the user without an extra check.
	 *
	 * This function will throw an exception if the user enables mfa.
	 */
	public static async login(deviceIdentifier: string, password: string, force: true): Promise<User>;

	/**
	 * Log the user in
	 *
	 * Store all user data in the storage (e.g. Indexeddb)
	 *
	 * For a refresh token flow -> send the refresh token to your server and save it in a http only strict cookie
	 * Then the user is safe for xss and csrf attacks
	 *
	 */
	public static async login(deviceIdentifier: string, password: string, force = false)
	{
		const out = await login(Sentc.options.base_url, Sentc.options.app_token, deviceIdentifier, password);

		const mfa_master_key = out.get_mfa_master_key();
		const mfa_auth_key = out.get_mfa_auth_key();

		if (mfa_master_key !== undefined && mfa_auth_key !== undefined) {
			if (force) {
				throw create_error("client_10000", "User enabled mfa and this must be handled.");
			}

			//mfa action needed
			return {
				kind: "mfa",
				u: {
					deviceIdentifier,
					mfa_auth_key,
					mfa_master_key
				}
			};
		}

		//at this point user disabled mfa
		const user = await this.buildUserObj(deviceIdentifier, out, false);

		if (force) {
			return user;
		}

		return {
			kind: "user",
			u: user
		};
	}

	public static async mfaLogin(token: string, login_data: UserMfaLogin)
	{
		const out = await mfa_login(
			Sentc.options.base_url,
			Sentc.options.app_token,
			login_data.mfa_master_key,
			login_data.mfa_auth_key,
			login_data.deviceIdentifier,
			token,
			false
		);

		return this.buildUserObj(login_data.deviceIdentifier, out, true);
	}

	public static async mfaRecoveryLogin(recovery_token: string, login_data: UserMfaLogin)
	{
		const out = await mfa_login(
			Sentc.options.base_url,
			Sentc.options.app_token,
			login_data.mfa_master_key,
			login_data.mfa_auth_key,
			login_data.deviceIdentifier,
			recovery_token,
			true
		);

		return this.buildUserObj(login_data.deviceIdentifier, out, true);
	}

	//__________________________________________________________________________________________________________________

	/**
	 * get a new jwt when the old one is expired
	 *
	 * The check is done automatically when making a sentc api request
	 *
	 * It can be refreshed directly with the sdk, a request to another backend with a cookie or with an own function
	 *
	 * @param old_jwt
	 * @param refresh_token
	 */
	public static refreshJwt(old_jwt: string, refresh_token: string)
	{
		const options = this.options.refresh;

		if (options.endpoint === REFRESH_ENDPOINT.api) {
			//make the req directly to the api, via wasm
			return refresh_jwt(this.options.base_url, this.options.app_token, old_jwt, refresh_token);
		}

		//refresh token is not needed for the other options because the dev is responsible to send the refresh token
		// e.g. via http only cookie

		if (options.endpoint === REFRESH_ENDPOINT.cookie) {
			const headers = new Headers();
			headers.append("Authorization", "Bearer " + old_jwt);

			//make the req without a body because the token sits in cookie
			return fetch(options.endpoint_url, {
				method: "GET",
				credentials: "include",
				headers
			}).then((res) => {return res.text();});
		}

		if (options.endpoint === REFRESH_ENDPOINT.cookie_fn) {
			//make the req via the cookie fn, where the dev can define an own refresh flow
			return options.endpoint_fn(old_jwt);
		}

		throw new Error("No refresh option found");
	}

	/**
	 * Get the actual used user data
	 *
	 * @throws Error
	 * when user is not set
	 */
	public static getActualUser(): Promise<User>;

	/**
	 * Get the actual user but with a valid jwt
	 * @param jwt
	 * @throws Error
	 * when user is not set or the jwt refresh failed
	 */
	public static getActualUser(jwt: true): Promise<User>;

	/**
	 * Get the actual used user and the username
	 *
	 * @param jwt
	 * @param username
	 * @throws Error
	 * when user not exists in the client
	 */
	public static getActualUser(jwt: false, username: true): Promise<[User, string]>;

	public static async getActualUser(jwt = false, username = false)
	{
		const storage = await this.getStore();

		const actualUser: string = await storage.getItem(USER_KEY_STORAGE_NAMES.actualUser);

		if (!actualUser) {
			throw new Error("No actual user found");
		}

		const user = await this.getUser(actualUser);

		if (!user) {
			throw new Error("The actual user data was not found");
		}

		if (jwt) {
			await user.getJwt();

			return user;
		}

		if (username) {
			return [user, actualUser];
		}

		return user;
	}

	/**
	 * Get any user matched by the user identifier.
	 *
	 * The user data is stored in the indexeddb (standard) or in memory
	 *
	 * @param userIdentifier
	 */
	public static async getUser(userIdentifier: string): Promise<User | false>
	{
		const storage = await this.getStore();

		const user = await storage.getItem<UserData>(USER_KEY_STORAGE_NAMES.userData + "_id_" + userIdentifier);

		if (!user) {
			return false;
		}

		return new User(this.options.base_url, this.options.app_token, user, userIdentifier);
	}
}