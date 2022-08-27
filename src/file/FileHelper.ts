/**
 * @author Jörn Heinemann <joernheinemann@gmx.de>
 * @since 2021/11/11
 */
import {AttachmentSessionData} from "../Enities";

export class FileHelper
{
	/**
	 * use the file reader to read a file
	 *
	 * return it as array buffer
	 *
	 * @param file
	 * @private
	 */
	public static fileParse(file: Blob): Promise<ArrayBuffer>;

	/**
	 * use the file reader to read a file
	 *
	 * return it as url string
	 *
	 * @param file
	 * @param asUrl
	 * @private
	 */
	public static fileParse(file: Blob, asUrl: boolean): Promise<string>;

	public static fileParse(file: Blob, asUrl = false)
	{
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			reader.onloadend = (e) => {
				//@ts-ignore -> is read as array buffer
				resolve(e.target.result);
			};

			reader.onerror = (e) => {
				reject(e);
			};

			if (asUrl) {
				reader.readAsDataURL(file);
			} else {
				reader.readAsArrayBuffer(file);
			}
		});
	}

	public static transferSessionData(sessionData: AttachmentSessionData)
	{
		const sessionIds: Map<number, string> = new Map();

		//the backend ordered the session data to the file types
		//now order to each frontend id the session id
		for (const typeData of sessionData) {
			//iterate over the data of each file type

			for (const data of typeData) {
				//iterate over the actual session data to each file

				sessionIds.set(data.frontendId as unknown as number, data.sessionId);
			}
		}

		return sessionIds;
	}
}