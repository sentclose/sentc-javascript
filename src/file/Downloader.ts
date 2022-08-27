/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/08/27
 */
import {Mutex} from "./Mutex";
import {StorageFactory, StorageInterface} from "../core";
import {file_download_and_decrypt_file_part, file_download_file_meta} from "sentc_wasm";
import {User} from "../User";
import {FileMetaInformation} from "../Enities";

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

		this.mutex = new Mutex();
	}

	constructor(private base_url: string, private app_token: string, private user: User)
	{
		//the base url can be different when serving the files from a different storage

		Downloader.init();
	}

	public async downloadFileMetaInformation(file_id: string): Promise<FileMetaInformation>
	{
		const jwt = await this.user.getJwt();

		//make a req to get the file info
		const file_meta = await file_download_file_meta(this.base_url, this.app_token, jwt, file_id);

		return {
			belongs_to: file_meta.get_belongs_to(),
			belongs_to_type: file_meta.get_belongs_to_type(),	//TODO test belongs to type enum
			file_id: file_meta.get_file_id(),
			key_id: file_meta.get_key_id(),
			part_list: file_meta.get_part_list()
		};
	}

	public downloadFileParts(part_list: string[], content_key: string): Promise<string>;

	public downloadFileParts(part_list: string[], content_key: string, updateProgressCb: (progress: number) => void): Promise<string>;

	public downloadFileParts(part_list: string[], content_key: string, updateProgressCb: (progress: number) => void | undefined, verify_key: string): Promise<string>;

	public async downloadFileParts(
		part_list: string[],
		content_key: string,
		updateProgressCb?: (progress: number) => void,
		verify_key = ""
	) {
		const jwt = await this.user.getJwt();

		const unlock = await Downloader.mutex.lock();
		const storage = await Downloader.getStorage();

		for (let i = 0; i < part_list.length; i++) {
			let part;

			try {
				// eslint-disable-next-line no-await-in-loop
				part = await file_download_and_decrypt_file_part(this.base_url, this.app_token, jwt, part_list[i], content_key, verify_key);
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

		const url = await this.downloadFileParts(file_meta.part_list, content_key, updateProgressCb, verify_key);

		return [
			url,
			file_meta
		];
	}
}