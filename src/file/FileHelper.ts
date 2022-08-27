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
}