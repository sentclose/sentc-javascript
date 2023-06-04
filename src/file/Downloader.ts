/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/27
 */
import {Mutex} from "./Mutex";
import {handle_server_response, make_req, StorageFactory, StorageInterface} from "../core";
import {file_download_and_decrypt_file_part, file_download_and_decrypt_file_part_start} from "sentc_wasm";
import {User} from "../User";
import {FileMetaFetched, FileMetaInformation, HttpMethod, PartListItem} from "../Enities";
import {Sentc} from "../Sentc";

export class Downloader
{
	private static init_storage = false;

	private static is_init = false;

	private static storage: StorageInterface;

	private static mutex: Mutex;

	public static cancel_download = false;

	public static async getStorage()
	{
		if (this.init_storage) {
			//dont init again
			return this.storage;
		}

		this.storage = await StorageFactory.getStorage(({err, warn}) => {
			console.error(err);
			console.warn(warn);
		});

		this.init_storage = true;

		return this.storage;
	}

	public static reset()
	{
		return this.storage.cleanStorage();
	}

	public static init()
	{
		if (this.is_init) {
			return;
		}

		this.is_init = true;

		this.mutex = new Mutex();
	}

	constructor(
		private base_url: string,
		private app_token: string,
		private user: User,
		private group_id?: string,
		private readonly group_as_member?: string
	) {
		//the base url can be different when serving the files from a different storage

		Downloader.init();
	}

	/**
	 * Get the file info and the first page of the file part list
	 *
	 * @param file_id
	 */
	public async downloadFileMetaInformation(file_id: string): Promise<FileMetaInformation>
	{
		const jwt = await this.user.getJwt();

		let url;

		if (this.group_id) {
			url = this.base_url + "/api/v1/group/" + this.group_id + "/file/" + file_id;
		} else {
			url = this.base_url + "/api/v1/file/" + file_id;
		}

		const res = await make_req(HttpMethod.GET, url, this.app_token, undefined, jwt, this.group_as_member);

		const file_meta: FileMetaFetched = handle_server_response(res);

		const part_list = file_meta.part_list;

		if (part_list.length >= 500) {
			//download parts via pagination
			let last_item = part_list[part_list.length - 1];
			let next_fetch = true;

			while (next_fetch) {
				// eslint-disable-next-line no-await-in-loop
				const fetched_parts = await this.downloadFilePartList(file_id, last_item);

				part_list.push(...fetched_parts);
				next_fetch = fetched_parts.length >= 500;
				last_item = fetched_parts[fetched_parts.length - 1];
			}
		}

		return {
			belongs_to: file_meta.belongs_to,
			belongs_to_type: file_meta.belongs_to_type,
			file_id: file_meta.file_id,
			master_key_id: file_meta.master_key_id,
			encrypted_key: file_meta.encrypted_key,
			encrypted_key_alg: file_meta.encrypted_key_alg,
			part_list,
			encrypted_file_name: file_meta.encrypted_file_name
		};
	}

	/**
	 * Download the rest of the part list via pagination
	 *
	 * @param file_id
	 * @param last_item
	 */
	public async downloadFilePartList(file_id: string, last_item: PartListItem | null = null): Promise<PartListItem[]>
	{
		const last_seq = last_item?.sequence + "" ?? "";

		const url = this.base_url + "/api/v1/file/" + file_id + "/part_fetch/" + last_seq;

		const res = await make_req(HttpMethod.GET, url, this.app_token);

		return handle_server_response(res);
	}

	public downloadFileParts(part_list: PartListItem[], content_key: string): Promise<string>;

	public downloadFileParts(part_list: PartListItem[], content_key: string, updateProgressCb: (progress: number) => void): Promise<string>;

	public downloadFileParts(part_list: PartListItem[], content_key: string, updateProgressCb: (progress: number) => void | undefined, verify_key: string): Promise<string>;

	public async downloadFileParts(
		part_list: PartListItem[],
		content_key: string,
		updateProgressCb?: (progress: number) => void,
		verify_key?: string
	) {
		const unlock = await Downloader.mutex.lock();
		const storage = await Downloader.getStorage();

		Downloader.cancel_download = false;

		const url_prefix = Sentc.options?.file_part_url ?? undefined;

		let next_file_key: string = content_key;

		for (let i = 0; i < part_list.length; i++) {
			const external = part_list[i].extern_storage === true;

			const part_url_base = (external) ? url_prefix : undefined;

			let part;

			try {
				if (i === 0) {
					//first part
					// eslint-disable-next-line no-await-in-loop
					const res = await file_download_and_decrypt_file_part_start(
						this.base_url,
						part_url_base,
						this.app_token,
						part_list[i].part_id,
						content_key,
						verify_key
					);
					next_file_key = res.get_next_file_key();
					part = res.get_file();
				} else {
					// eslint-disable-next-line no-await-in-loop
					const res = await file_download_and_decrypt_file_part(
						this.base_url,
						part_url_base,
						this.app_token,
						part_list[i].part_id,
						next_file_key,
						verify_key
					);
					next_file_key = res.get_next_file_key();
					part = res.get_file();
				}
			} catch (e) {
				// eslint-disable-next-line no-await-in-loop
				await Downloader.reset();	//remove the downloaded parts from the store
				unlock();

				throw e;
			}

			if (!part) {
				// eslint-disable-next-line no-await-in-loop
				await Downloader.reset();	//remove the downloaded parts from the store
				unlock();

				throw Error("Part not found");
			}

			// eslint-disable-next-line no-await-in-loop
			await storage.storePart(part);

			if (updateProgressCb) {
				updateProgressCb((i + 1) / part_list.length);
			}

			if (Downloader.cancel_download) {
				Downloader.cancel_download = false;

				// eslint-disable-next-line no-await-in-loop
				await Downloader.reset();	//remove the downloaded parts from the store
				unlock();

				return "";
			}
		}

		const url = await storage.getDownloadUrl();

		await Downloader.reset();

		unlock();

		return url;
	}
}