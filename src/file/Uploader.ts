import {User} from "../User";
import {file_register_file, file_upload_part} from "sentc_wasm";
import {FileHelper} from "./FileHelper";

/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/27
 */

export class Uploader
{
	private readonly belongs_to_id?: string;

	private readonly belongs_to?: string;

	constructor(
		private base_url: string,
		private app_token: string,
		private user: User,
		private chunk_size = 1024 * 1024 * 4,
		private upload_callback?: (progress?: number) => void,
		private group_id?: string,
		private other_user_id?: string
	) {
		if (group_id && group_id !== "") {
			this.belongs_to_id = group_id;
			this.belongs_to = "\"Group\"";	//the double "" are important for rust serde json
		} else if (other_user_id && other_user_id !== "") {
			this.belongs_to_id = other_user_id;
			this.belongs_to = "\"User\"";
		} else {
			this.belongs_to_id = "";
			this.belongs_to = "\"None\"";
		}
	}

	public async uploadFile(file: File, content_key: string, sign = false)
	{
		const jwt = await this.user.getJwt();

		let sign_key = "";

		if (sign) {
			sign_key = await this.user.getSignKey();
		}

		//create a new file on the server, and save the content key id
		const out = await file_register_file(
			this.base_url,
			this.app_token,
			jwt,
			content_key,
			this.belongs_to_id,
			this.belongs_to,
			file.name,
			this.group_id
		);

		const session_id = out.get_session_id();
		const file_id = out.get_file_id();

		let start = 0;
		let end = this.chunk_size;

		const totalChunks = Math.ceil(file.size / this.chunk_size);
		let currentChunk = 0;

		while (start < file.size) {
			++currentChunk;

			// eslint-disable-next-line no-await-in-loop
			const part = await FileHelper.fileParse(file.slice(start, end));

			start = end;
			end = start + this.chunk_size;
			const isEnd = start >= file.size;

			// eslint-disable-next-line no-await-in-loop
			await file_upload_part(
				this.base_url,
				this.app_token,
				jwt,
				session_id,
				isEnd,
				currentChunk,
				content_key,
				sign_key,
				new Uint8Array(part)
			);

			this.upload_callback(currentChunk / totalChunks);
		}

		return file_id;
	}
}