/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/19
 */
import {AbstractCrypto} from "./AbstractCrypto";
import {CryptoHead, CryptoRawOutput, UserPublicKeyData} from "../Enities";
import {
	decrypt_asymmetric,
	decrypt_raw_asymmetric,
	decrypt_string_asymmetric,
	deserialize_head_from_string,
	encrypt_asymmetric,
	encrypt_raw_asymmetric,
	encrypt_string_asymmetric,
	generate_non_register_sym_key_by_public_key,
	split_head_and_encrypted_data,
	split_head_and_encrypted_string
} from "sentc_wasm";
import {getNonRegisteredKeyByPrivateKey, SymKey} from "./SymKey";
import {Sentc} from "../Sentc";

export abstract class AbstractAsymCrypto extends AbstractCrypto
{
	/**
	 * Fetch the public key for this user
	 *
	 * @param reply_id
	 */
	abstract getPublicKey(reply_id: string): Promise<UserPublicKeyData>;

	/**
	 * Get the own private key
	 * because only the actual user got access to the private key
	 *
	 * @param key_id
	 */
	abstract getPrivateKey(key_id: string): Promise<string>;

	abstract getPrivateKeySync(key_id: string): string;

	abstract getSignKey(): Promise<string>;

	abstract getSignKeySync(): string;

	abstract getJwt(): Promise<string>;

	public encryptRaw(data: Uint8Array, reply_id: string): Promise<CryptoRawOutput>;

	public encryptRaw(data: Uint8Array, reply_id: string, sign: true): Promise<CryptoRawOutput>;

	public async encryptRaw(data: Uint8Array, reply_id: string, sign = false): Promise<CryptoRawOutput>
	{
		const key = await this.getPublicKey(reply_id);

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		const out = encrypt_raw_asymmetric(key.public_key, data, sign_key);

		return {
			head: out.get_head(),
			data: out.get_data()
		};
	}

	public encryptRawSync(data: Uint8Array, reply_public_key: string, sign = false): CryptoRawOutput
	{
		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		const out = encrypt_raw_asymmetric(reply_public_key, data, sign_key);

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

		const key = await this.getPrivateKey(de_head.id);

		return decrypt_raw_asymmetric(key, encrypted_data, head, verify_key);
	}

	public decryptRawSync(head: string, encrypted_data: Uint8Array, verify_key?: string)
	{
		const de_head: CryptoHead = deserialize_head_from_string(head);

		const key = this.getPrivateKeySync(de_head.id);

		return decrypt_raw_asymmetric(key, encrypted_data, head, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public async encrypt(data: Uint8Array, reply_id: string): Promise<Uint8Array>

	public async encrypt(data: Uint8Array, reply_id: string, sign: true): Promise<Uint8Array>

	public async encrypt(data: Uint8Array, reply_id: string, sign = false): Promise<Uint8Array>
	{
		const key = await this.getPublicKey(reply_id);

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		return encrypt_asymmetric(key.public_key, data, sign_key);
	}

	public encryptSync(data: Uint8Array, reply_public_key: string, sign = false)
	{
		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		return encrypt_asymmetric(reply_public_key, data, sign_key);
	}

	public decrypt(data: Uint8Array): Promise<Uint8Array>;

	public decrypt(data: Uint8Array, verify: boolean, user_id: string): Promise<Uint8Array>;

	public async decrypt(data: Uint8Array, verify = false, user_id?: string): Promise<Uint8Array>
	{
		const head: CryptoHead = split_head_and_encrypted_data(data);
		const key = await this.getPrivateKey(head.id);

		if (!head?.sign || !verify || !user_id) {
			return decrypt_asymmetric(key, data);
		}

		const verify_key = await Sentc.getUserVerifyKeyData(this.base_url, this.app_token, user_id, head.sign.id);

		return decrypt_asymmetric(key, data, verify_key);
	}

	public decryptSync(data: Uint8Array, verify_key?: string)
	{
		const head: CryptoHead = split_head_and_encrypted_data(data);
		const key = this.getPrivateKeySync(head.id);

		return decrypt_asymmetric(key, data, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public encryptString(data: string, reply_id:string): Promise<string>;

	public encryptString(data: string, reply_id:string, sign: true): Promise<string>;

	public async encryptString(data: string, reply_id: string, sign = false): Promise<string>
	{
		const key = await this.getPublicKey(reply_id);

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.getSignKey();
		}

		return encrypt_string_asymmetric(key.public_key, data, sign_key);
	}

	public encryptStringSync(data: string, reply_public_key: string, sign = false)
	{
		let sign_key: string | undefined;

		if (sign) {
			sign_key = this.getSignKeySync();
		}

		return encrypt_string_asymmetric(reply_public_key, data, sign_key);
	}

	public decryptString(data: string): Promise<string>;

	public decryptString(data: string, verify: boolean, user_id: string): Promise<string>;

	public async decryptString(data: string, verify = false, user_id?: string): Promise<string>
	{
		const head: CryptoHead = split_head_and_encrypted_string(data);
		const key = await this.getPrivateKey(head.id);

		if (!head?.sign || !verify || !user_id) {
			return decrypt_string_asymmetric(key, data);
		}

		const verify_key = await Sentc.getUserVerifyKeyData(this.base_url, this.app_token, user_id, head.sign.id);

		return decrypt_string_asymmetric(key, data, verify_key);
	}

	public decryptStringSync(data: string, verify_key?: string)
	{
		const head: CryptoHead = split_head_and_encrypted_string(data);
		const key = this.getPrivateKeySync(head.id);

		return decrypt_string_asymmetric(key, data, verify_key);
	}

	//__________________________________________________________________________________________________________________

	public async generateNonRegisteredKey(reply_id: string): Promise<[SymKey, string]>
	{
		const key_data = await this.getPublicKey(reply_id);

		const key_out = generate_non_register_sym_key_by_public_key(key_data.public_key);

		const encrypted_key = key_out.get_encrypted_key();
		const key = key_out.get_key();

		return [new SymKey(this.base_url, this.app_token, key, "non_register", key_data.public_key_id, await this.getSignKey()), encrypted_key];
	}

	public async getNonRegisteredKey(master_key_id: string, key: string)
	{
		const private_key = await this.getPrivateKey(master_key_id);

		return getNonRegisteredKeyByPrivateKey(private_key, key, master_key_id, await this.getSignKey());
	}
}