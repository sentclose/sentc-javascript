/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/07/16
 */

import init, {
	check_user_identifier_available,
	done_check_user_identifier_available,
	done_login,
	done_register,
	done_register_device_start,
	generate_user_register_data, group_extract_public_key_data,
	init_user,
	InitInput,
	login,
	prepare_check_user_identifier_available,
	prepare_login,
	prepare_login_start,
	prepare_register,
	prepare_register_device_start,
	refresh_jwt,
	register,
	register_device_start,
	user_fetch_public_key,
	user_fetch_verify_key,
	user_verify_user_public_key,
	UserData as WasmUserData
} from "sentc_wasm";
import {
	GroupOutDataHmacKeys,
	HttpMethod,
	USER_KEY_STORAGE_NAMES,
	UserData,
	UserDeviceKeyData,
	UserId,
	UserKeyData,
	UserPublicKeyData
} from "./Enities";
import {make_req, ResCallBack, StorageFactory, StorageInterface} from "./core";
import {getUser, User} from "./User";

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

export interface StorageOptions {
	errCallBack: ResCallBack,
}

export interface SentcOptions {
	base_url?: string,
	app_token: string,
	file_part_url?: string,
	refresh?: RefreshOptions,
	storage?: {
		default_storage?: StorageOptions,
		getStorage?: () => Promise<StorageInterface>
	},
	wasm_path?: InitInput | Promise<InitInput>
}

export class Sentc
{
	private static init_client = false;

	private static init_storage = false;

	private static storage: StorageInterface;

	//@ts-ignore
	public static options: SentcOptions = {};
	
	public static async getStore()
	{
		//only init when needed
		if (this.init_storage) {
			//dont init again
			return this.storage;
		}

		if (this.options?.storage?.getStorage) {
			this.storage = await this.options.storage.getStorage();

			this.init_storage = true;

			return this.storage;
		}

		let errCallBack: ResCallBack;

		if (this.options?.storage?.default_storage) {
			errCallBack = this.options.storage.default_storage.errCallBack;
		} else {
			errCallBack = ({err, warn}) => {
				console.error(err);
				console.warn(warn);
			};
		}

		this.storage = await StorageFactory.getStorage(errCallBack, "sentclose", "keys");

		this.init_storage = true;

		return this.storage;
	}

	/**
	 * Initialize the client.
	 *
	 * This only works in a browser environment.
	 * If using ssr, exe init only in the client, not on the server
	 *
	 * load the wasm file (from the app options url or the cdn url)
	 */
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

		await init(options.wasm_path);	//init wasm

		const base_url = options?.base_url ?? "https://api.sentc.com";

		const refresh: RefreshOptions = options?.refresh ?? {
			endpoint: REFRESH_ENDPOINT.api,
			endpoint_url: base_url + "/api/v1/refresh"
		};

		Sentc.options = {
			base_url,
			app_token: options?.app_token,
			storage: options?.storage,
			refresh,
			file_part_url: options?.file_part_url
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
	public static checkUserIdentifierAvailable(userIdentifier: string)
	{
		if (userIdentifier === "") {
			return false;
		}

		return check_user_identifier_available(Sentc.options.base_url, Sentc.options.app_token, userIdentifier);
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

	public static prepareRegisterDeviceStart(device_identifier: string, password: string)
	{
		return prepare_register_device_start(device_identifier, password);
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

	/**
	 * Make the first login request to get the salt
	 */
	public static prepareLoginStart(userIdentifier: string)
	{
		return prepare_login_start(Sentc.options.base_url, Sentc.options.app_token, userIdentifier);
	}

	/**
	 * Prepare the data to done login process.
	 *
	 * prepare_login_server_output is the result of the prepareLoginStart function
	 *
	 * Send the auth key string to the server and use the master_key_encryption_key for the done login function
	 */
	public static prepareLogin(userIdentifier: string, password: string, prepare_login_server_output: string)
	{
		const data = prepare_login(userIdentifier, password, prepare_login_server_output);

		return [data.get_auth_key(), data.get_master_key_encryption_key()];
	}

	/**
	 * Get and decrypt the user data from the done_login_server_output output
	 *
	 * prepare login is required
	 */
	public static doneLogin(deviceIdentifier: string, master_key_encryption_key: string, done_login_server_output: string)
	{
		const out = done_login(master_key_encryption_key, done_login_server_output);

		return this.buildUserObj(deviceIdentifier, out);
	}

	private static buildUserObj(deviceIdentifier: string, out: WasmUserData)
	{
		const device: UserDeviceKeyData = {
			private_key: out.get_device_private_key(),
			public_key: out.get_device_public_key(),
			sign_key: out.get_device_sign_key(),
			verify_key: out.get_device_verify_key(),
			exported_public_key: out.get_device_exported_public_key(),
			exported_verify_key: out.get_device_exported_verify_key()
		};

		const user_keys: UserKeyData[] = out.get_user_keys();

		const hmac_keys: GroupOutDataHmacKeys[] = out.get_hmac_keys();

		const user_data: UserData = {
			device,
			user_keys,
			jwt: out.get_jwt(),
			refresh_token: out.get_refresh_token(),
			user_id: out.get_id(),
			device_id: out.get_device_id(),
			key_map: new Map(),
			newest_key_id: "",
			hmac_keys: []
		};

		return getUser(deviceIdentifier, user_data, hmac_keys);
	}

	/**
	 * Log the user in
	 *
	 * Store all user data in the storage (e.g. Indexeddb)
	 *
	 * For a refresh token flow -> send the refresh token to your server and save it in a http only strict cookie
	 * Then the user is safe for xss and csrf attacks
	 *
	 */
	public static async login(deviceIdentifier: string, password: string)
	{
		const out = await login(Sentc.options.base_url, Sentc.options.app_token, deviceIdentifier, password);

		return this.buildUserObj(deviceIdentifier, out);
	}

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

	public static getUserPublicKey(user_id: string)
	{
		return this.getUserPublicKeyData(this.options.base_url, this.options.app_token, user_id);
	}

	public static getUserVerifyKey(user_id: string, key_id: string)
	{
		return this.getUserVerifyKeyData(this.options.base_url, this.options.app_token, user_id, key_id);
	}

	public static getGroupPublicKey(group_id)
	{
		return this.getGroupPublicKeyData(this.options.base_url, this.options.app_token, group_id);
	}

	public static verifyUserPublicKey(user_id: string, public_key: UserPublicKeyData, force = false)
	{
		return this.verifyUsersPublicKey(this.options.base_url, this.options.app_token, user_id, public_key, force);
	}

	//__________________________________________________________________________________________________________________

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

	/**
	 * The same as getUserPublicData but only fetched the public key
	 *
	 * @param base_url
	 * @param app_token
	 * @param user_id
	 */
	public static async getUserPublicKeyData(base_url: string, app_token: string, user_id: string): Promise<UserPublicKeyData>
	{
		const storage = await this.getStore();

		const store_key = USER_KEY_STORAGE_NAMES.userPublicKey + "_id_" + user_id;

		const user = await storage.getItem<UserPublicKeyData>(store_key);

		if (user) {
			return user;
		}

		const fetched_data = await user_fetch_public_key(base_url, app_token, user_id);

		const public_key = fetched_data.get_public_key();
		const public_key_id = fetched_data.get_public_key_id();
		const public_key_sig_key_id = fetched_data.get_public_key_sig_key_id();

		const returns: UserPublicKeyData = {public_key, public_key_id, public_key_sig_key_id, verified: false};

		await storage.set(store_key, returns);

		return returns;
	}

	/**
	 * The same as getUserPublicData but only fetched the verify key
	 *
	 * @param base_url
	 * @param app_token
	 * @param user_id
	 * @param verify_key_id
	 */
	public static async getUserVerifyKeyData(base_url: string, app_token: string, user_id: string, verify_key_id: string): Promise<string>
	{
		const storage = await this.getStore();

		const store_key = USER_KEY_STORAGE_NAMES.userVerifyKey + "_id_" + user_id + "_key_id_" + verify_key_id;

		const user = await storage.getItem<string>(store_key);

		if (user) {
			return user;
		}

		const key = await user_fetch_verify_key(base_url, app_token, user_id, verify_key_id);
		
		await storage.set(store_key, key);

		return key;
	}

	public static async getGroupPublicKeyData(base_url: string, app_token: string, group_id: string): Promise<{key: string, id: string}>
	{
		const storage = await this.getStore();
		const store_key = USER_KEY_STORAGE_NAMES.groupPublicKey + "_id_" + group_id;

		const group = await storage.getItem<{key: string, id: string}>(store_key);

		if (group) {
			return group;
		}

		const url = `${base_url}/api/v1/group/${group_id}/public_key`;
		const res = await make_req(HttpMethod.GET, url, app_token);

		const fetched_data = await group_extract_public_key_data(res);

		const key = fetched_data.get_public_key();
		const id = fetched_data.get_public_key_id();

		const returns = {key, id};

		await storage.set(store_key, returns);

		return returns;
	}

	public static async verifyUsersPublicKey(base_url: string, app_token: string, user_id: string, public_key: UserPublicKeyData, force = false)
	{
		if (public_key.verified && !force) {
			return true;
		}

		if (!public_key.public_key_sig_key_id) {
			return false;
		}

		const verify_key = await this.getUserVerifyKey(user_id, public_key.public_key_sig_key_id);

		const verify = user_verify_user_public_key(verify_key, public_key.public_key);

		public_key.verified = verify;

		//store the new value
		const storage = await this.getStore();
		const store_key = USER_KEY_STORAGE_NAMES.userPublicKey + "_id_" + user_id;
		await storage.set(store_key, public_key);

		return verify;
	}
}