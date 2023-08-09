/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2022/07/16
 */
import {InitReturn, StorageInterface} from ".";
import {IDBPDatabase, openDB} from "idb";

export class IndexeddbStorage implements StorageInterface
{
	private db: IDBPDatabase;

	public isInit = false;

	constructor(
		private dbName: string = "sentc_encrypt_files",
		private storeName: string = "decrypted_files"
	) {}

	public async init(): Promise<InitReturn>
	{
		if (!("indexedDB" in window)) {
			return {
				status: false,
				err: "Indexeddb is not supported"
			};
		}

		const name = this.storeName;

		try {
			this.db = await openDB(this.dbName, 1, {
				upgrade(db) {
					db.createObjectStore(name, {autoIncrement: true});
				}
			});
		} catch (e) {
			return {
				status: false,
				err: "Indexeddb is not supported"
			};
		}

		this.isInit = true;

		return {status: true};
	}

	public cleanStorage(): Promise<void>
	{
		return this.db.clear(this.storeName);
	}

	public delete(key: string): Promise<void>
	{
		return this.db.delete(this.storeName, key);
	}

	public getItem(key: string)
	{
		return this.db.get(this.storeName, key);
	}

	public set(key: string, item: any)
	{
		return this.db.put(this.storeName, item, key);
	}
}