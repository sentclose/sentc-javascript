/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2021/09/16
 */

/**
 * Mix of:
 * - https://stackoverflow.com/a/51086893/12177973
 * - https://github.com/mgtitimoli/await-mutex/blob/master/src/mutex.js
 */
export class Mutex
{
	private current: Promise<any | void>;

	constructor()
	{
		this.current = Promise.resolve();
	}

	public lock(): Promise<() => void>
	{
		let unlockNext;

		const p = new Promise<void>((resolve) => {
			unlockNext = () => {
				return resolve();
			};
		});

		const unlock = this.current.then(() => { return unlockNext; });

		this.current = p;

		return unlock;
	}
}