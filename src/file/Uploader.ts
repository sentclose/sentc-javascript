import {User} from "../User";
import {
	file_done_register_file,
	file_prepare_register_file,
	file_register_file,
	file_upload_part,
	file_upload_part_start
} from "sentc_wasm";
import {FileHelper} from "./FileHelper";
import {Sentc} from "../Sentc";

/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/27
 */

export class Uploader
{
	private readonly belongs_to_id?: string;

	private readonly belongs_to?: string;

	public static cancel_upload = false;

	constructor(
		private base_url: string,
		private app_token: string,
		private user: User,
		private group_id?: string,
		private other_user_id?: string,
		private upload_callback?: (progress?: number) => void,
		private readonly group_as_member?: string,
		private chunk_size = 1024 * 1024 * 4
	) {
		if (group_id && group_id !== "") {
			this.belongs_to_id = group_id;
			this.belongs_to = "\"Group\"";	//the double "" are important for rust serde json
		} else if (other_user_id && other_user_id !== "") {
			this.belongs_to_id = other_user_id;
			this.belongs_to = "\"User\"";
		} else {
			this.belongs_to = "\"None\"";
		}
	}

	public prepareFileRegister(file: File, content_key: string, encrypted_content_key: string, master_key_id: string)
	{
		const out = file_prepare_register_file(
			master_key_id,
			content_key,
			encrypted_content_key,
			this.belongs_to_id,
			this.belongs_to,
			file.name
		);
		
		const encrypted_file_name = out.get_encrypted_file_name();
		const server_input = out.get_server_input();

		return [server_input, encrypted_file_name];
	}

	public doneFileRegister(server_output: string)
	{
		const out = file_done_register_file(server_output);

		const file_id = out.get_file_id();
		const session_id = out.get_session_id();

		return [file_id, session_id];
	}

	public async checkFileUpload(file: File, content_key: string, session_id: string, sign = false)
	{
		const jwt = await this.user.getJwt();

		let sign_key: string | undefined;

		if (sign) {
			sign_key = await this.user.getSignKey();
		}

		let start = 0;
		let end = this.chunk_size;

		const totalChunks = Math.ceil(file.size / this.chunk_size);
		let currentChunk = 0;

		//reset it just in case it was true
		Uploader.cancel_upload = false;

		const url_prefix = Sentc.options?.file_part_url ?? undefined;

		//each file is encrypted by a new key and this key is encrypted by the pre key
		let next_file_key: string = content_key;

		while (start < file.size) {
			++currentChunk;

			// eslint-disable-next-line no-await-in-loop
			const part = await FileHelper.fileParse(file.slice(start, end));

			start = end;
			end = start + this.chunk_size;
			const isEnd = start >= file.size;

			if (currentChunk === 1) {
				//first chunk
				// eslint-disable-next-line no-await-in-loop
				next_file_key = await file_upload_part_start(
					this.base_url,
					url_prefix,
					this.app_token,
					jwt,
					session_id,
					isEnd,
					currentChunk,
					content_key,
					sign_key,
					new Uint8Array(part)
				);
			} else {
				// eslint-disable-next-line no-await-in-loop
				next_file_key = await file_upload_part(
					this.base_url,
					url_prefix,
					this.app_token,
					jwt,
					session_id,
					isEnd,
					currentChunk,
					next_file_key,
					sign_key,
					new Uint8Array(part)
				);
			}

			if (this.upload_callback) {
				this.upload_callback(currentChunk / totalChunks);
			}

			if (Uploader.cancel_upload) {
				Uploader.cancel_upload = false;
				break;
			}
		}
	}

	public async uploadFile(file: File, content_key: string, encrypted_content_key: string, master_key_id: string, sign = false)
	{
		const jwt = await this.user.getJwt();

		//create a new file on the server, and save the content key id
		const out = await file_register_file(
			this.base_url,
			this.app_token,
			jwt,
			master_key_id,
			content_key,
			encrypted_content_key,
			this.belongs_to_id,
			this.belongs_to,
			file.name,
			this.group_id,
			this.group_as_member
		);

		const session_id = out.get_session_id();
		const file_id = out.get_file_id();
		const encrypted_file_name = out.get_encrypted_file_name();

		await this.checkFileUpload(file, content_key, session_id, sign);

		return [file_id, encrypted_file_name];
	}
}