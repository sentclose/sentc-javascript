/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/27
 */
import {Mutex} from "./Mutex";
import {StorageFactory, StorageInterface} from "../core";
import {
	decrypt_string_symmetric,
	file_download_and_decrypt_file_part,
	file_download_file_meta,
	file_download_part_list
} from "sentc_wasm";
import {User} from "../User";
import {FileMetaInformation, PartListItem} from "../Enities";

export class Downloader
{
	private static init_storage = false;

	private static is_init = false;

	private static storage: StorageInterface;

	private static mutex: Mutex;

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
		private group_id?: string
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

		//make a req to get the file info
		const file_meta = await file_download_file_meta(
			this.base_url,
			this.app_token,
			jwt,
			file_id,
			this.group_id ? this.group_id : ""
		);

		const part_list: PartListItem[] = file_meta.get_part_list();

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
			belongs_to: file_meta.get_belongs_to(),
			belongs_to_type: file_meta.get_belongs_to_type(),
			file_id: file_meta.get_file_id(),
			key_id: file_meta.get_key_id(),
			part_list,
			encrypted_file_name: file_meta.get_encrypted_file_name()
		};
	}

	/**
	 * Download the rest of the part list via pagination
	 *
	 * @param file_id
	 * @param last_item
	 */
	public downloadFilePartList(file_id: string, last_item: PartListItem | null = null): Promise<PartListItem[]>
	{
		const last_seq = last_item?.sequence + "" ?? "";

		return file_download_part_list(this.base_url, this.app_token, file_id, last_seq);
	}

	public downloadFileParts(part_list: PartListItem[], content_key: string): Promise<string>;

	public downloadFileParts(part_list: PartListItem[], content_key: string, updateProgressCb: (progress: number) => void): Promise<string>;

	public downloadFileParts(part_list: PartListItem[], content_key: string, updateProgressCb: (progress: number) => void | undefined, verify_key: string): Promise<string>;

	public async downloadFileParts(
		part_list: PartListItem[],
		content_key: string,
		updateProgressCb?: (progress: number) => void,
		verify_key = ""
	) {
		const unlock = await Downloader.mutex.lock();
		const storage = await Downloader.getStorage();

		for (let i = 0; i < part_list.length; i++) {
			const external = part_list[i].extern_storage === true;

			const part_url_base = (external) ? this.user.file_part_prefix_url : "";

			let part;

			try {
				// eslint-disable-next-line no-await-in-loop
				part = await file_download_and_decrypt_file_part(this.base_url, part_url_base, this.app_token, part_list[i].part_id, content_key, verify_key);
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
		}

		const url = await storage.getDownloadUrl();

		await Downloader.reset();

		unlock();

		return url;
	}

	public downloadFile(file_id: string, content_key: string): Promise<[string, FileMetaInformation]>;

	public downloadFile(file_id: string, content_key: string, updateProgressCb: (progress: number) => void): Promise<[string, FileMetaInformation]>;

	public downloadFile(file_id: string, content_key: string, updateProgressCb: (progress: number) => void | undefined, verify_key: string): Promise<[string, FileMetaInformation]>;

	public async downloadFile(file_id: string, content_key: string, updateProgressCb?: (progress: number) => void, verify_key = ""): Promise<[string, FileMetaInformation]>
	{
		//make a req to get the file info
		const file_meta = await this.downloadFileMetaInformation(file_id);

		file_meta.file_name = decrypt_string_symmetric(content_key, file_meta.encrypted_file_name, verify_key);

		const url = await this.downloadFileParts(file_meta.part_list, content_key, updateProgressCb, verify_key);

		return [
			url,
			file_meta
		];
	}
}