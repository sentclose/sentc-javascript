import {CryptoHead, CryptoRawOutput} from "../Enities";
import {
	decrypt_raw_symmetric, decrypt_string_symmetric, decrypt_symmetric,
	deserialize_head_from_string,
	encrypt_raw_symmetric, encrypt_string_symmetric,
	encrypt_symmetric, generate_non_register_sym_key,
	split_head_and_encrypted_data, split_head_and_encrypted_string
} from "sentc_wasm";
import {AbstractCrypto} from "./AbstractCrypto";
import {getNonRegisteredKey, SymKey} from "./SymKey";
import {Sentc} from "../Sentc";

/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/19
 */

export abstract class AbstractSymCrypto extends AbstractCrypto
{
	/**
	 * The latest used key (e.g. the latest group key)
	 *
	 * return the key and the key id
	 */
	abstract getSymKeyToEncrypt(): Promise<[string, string]>;

	abstract getSymKeyToEncryptSync(): [string, string];

	abstract getSymKeyById(key_id: string): Promise<string>;

	abstract getSymKeyByIdSync(key_id: string): string;

	abstract getSignKey(): Promise<string>;

	abstract getSignKeySync(): string;

	abstract getJwt(): Promise<string>;

	public encryptRaw(data: Uint8Array): Promise<CryptoRawOutput>;

	public encryptRaw(data: Uint8Array, sign: true): Promise<CryptoRawOutput>;

	public async encryptRaw(data: Uint8Array, sign = false): Promise<CryptoRawOutput>
	{
		const key = await this.getSymKeyToEncrypt();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		const out = encrypt_raw_symmetric(key[0], data, sign_key);

		return {
			head: out.get_head(),
			data: out.get_data()
		};
	}

	public encryptRawSync(data: Uint8Array, sign = false): CryptoRawOutput
	{
		const key = this.getSymKeyToEncryptSync();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		const out = encrypt_raw_symmetric(key[0], data, sign_key);

		return {
			head: out.get_head(),
			data: out.get_data()
		};
	}

	public decryptRaw(head: string, encrypted_data: Uint8Array): Promise<Uint8Array>;

	public decryptRaw(head: string, encrypted_data: Uint8Array, verify_key: string): Promise<Uint8Array>;

	public async decryptRaw(head: string, encrypted_data: Uint8Array, verify_key?: string): Promise<Uint8Array>
	{
		const de_head: CryptoHead = deserialize_head_from_string(head);

		const key = await this.getSymKeyById(de_head.id);

		return decrypt_raw_symmetric(key, encrypted_data, head, verify_key);
	}

	public decryptRawSync(head: string, encrypted_data: Uint8Array, verify_key?: string): Uint8Array
	{
		const de_head: CryptoHead = deserialize_head_from_string(head);

		const key = this.getSymKeyByIdSync(de_head.id);

		return decrypt_raw_symmetric(key, encrypted_data, head, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public async encrypt(data: Uint8Array): Promise<Uint8Array>

	public async encrypt(data: Uint8Array, sign: true): Promise<Uint8Array>

	public async encrypt(data: Uint8Array, sign = false): Promise<Uint8Array>
	{
		const key = await this.getSymKeyToEncrypt();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		return encrypt_symmetric(key[0], data, sign_key);
	}

	public encryptSync(data: Uint8Array, sign = false): Uint8Array
	{
		const key = this.getSymKeyToEncryptSync();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		return encrypt_symmetric(key[0], data, sign_key);
	}

	public decrypt(data: Uint8Array): Promise<Uint8Array>;

	public decrypt(data: Uint8Array, verify: true, user_id: string): Promise<Uint8Array>;

	public async decrypt(data: Uint8Array, verify = false, user_id?: string): Promise<Uint8Array>
	{
		const head: CryptoHead = split_head_and_encrypted_data(data);

		const key = await this.getSymKeyById(head.id);

		if (!head?.sign || !verify || !user_id) {
			return decrypt_symmetric(key, data);
		}

		const verify_key = await Sentc.getUserVerifyKeyData(this.base_url, this.app_token, user_id, head.sign.id);

		return decrypt_symmetric(key, data, verify_key);
	}

	public decryptSync(data: Uint8Array, verify_key?: string): Uint8Array
	{
		const head: CryptoHead = split_head_and_encrypted_data(data);

		const key = this.getSymKeyByIdSync(head.id);

		return decrypt_symmetric(key, data, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public encryptString(data: string): Promise<string>;

	public encryptString(data: string, sign: true): Promise<string>;

	public async encryptString(data: string, sign = false): Promise<string>
	{
		const key = await this.getSymKeyToEncrypt();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		return encrypt_string_symmetric(key[0], data, sign_key);
	}

	public encryptStringSync(data: string, sign = false): string
	{
		const key = this.getSymKeyToEncryptSync();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		return encrypt_string_symmetric(key[0], data, sign_key);
	}

	public decryptString(data: string): Promise<string>;

	public decryptString(data: string, verify_key: true, user_id: string): Promise<string>;

	public async decryptString(data: string, verify = false, user_id?: string): Promise<string>
	{
		const head: CryptoHead = split_head_and_encrypted_string(data);

		const key = await this.getSymKeyById(head.id);

		if (!head?.sign || !verify || !user_id) {
			return decrypt_string_symmetric(key, data);
		}

		const verify_key = await Sentc.getUserVerifyKeyData(this.base_url, this.app_token, user_id, head.sign.id);

		return decrypt_string_symmetric(key, data, verify_key);
	}

	public decryptStringSync(data: string, verify_key?: string): string
	{
		const head: CryptoHead = split_head_and_encrypted_string(data);

		const key = this.getSymKeyByIdSync(head.id);

		return decrypt_string_symmetric(key, data, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public async generateNonRegisteredKey(): Promise<[SymKey, string]>
	{
		const key_data = await this.getSymKeyToEncrypt();

		const key_out = generate_non_register_sym_key(key_data[0]);

		const encrypted_key = key_out.get_encrypted_key();
		const key = key_out.get_key();

		return [new SymKey(this.base_url, this.app_token, key, "non_register", key_data[1], await this.getSignKey()), encrypted_key];
	}

	public async getNonRegisteredKey(master_key_id: string, key: string)
	{
		const master_key = await this.getSymKeyById(master_key_id);

		return getNonRegisteredKey(master_key, key, master_key_id, await this.getSignKey());
	}

	//__________________________________________________________________________________________________________________
}