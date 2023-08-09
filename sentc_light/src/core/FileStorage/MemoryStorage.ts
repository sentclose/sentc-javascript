/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2021/07/12
 */
import {StorageInterface, InitReturn} from ".";

export class MemoryStorage implements StorageInterface
{
	private store: Map<string, any> = new Map();

	public cleanStorage(): Promise<void>
	{
		this.store = new Map();

		return Promise.resolve();
	}

	public init(): Promise<InitReturn>
	{
		return Promise.resolve({
			status: true,
			warn: "Can't save large files and can't stay logged in during page refresh"
		});
	}

	public delete(key: string): Promise<void>
	{
		this.store.delete(key);

		return Promise.resolve(undefined);
	}

	public getItem(key: string): Promise<any | undefined>
	{
		return Promise.resolve(this.store.get(key));
	}

	public set(key: string, item: any): Promise<any>
	{
		this.store.set(key, item);

		return Promise.resolve();
	}
}