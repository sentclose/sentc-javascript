describe("File test", () => {
	const file_test = new ArrayBuffer(1000 * 1000 * 4 * 3);

	const username0 = "test0";
	const username1 = "test1";

	const pw = "12345";

	/** @type User */
	let user0, user1;

	/** @type string */
	let file_1, file_2;

	const sentc = window.Sentc.default;

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});

		//register two users for the group

		await sentc.register(username0, pw);

		user0 = await sentc.login(username0, pw, true);

		await sentc.register(username1, pw);

		user1 = await sentc.login(username1, pw, true);
	});

	it("should prepare register a file manually", async function() {
		const file_item = new File([file_test], "hello");

		const out = await user0.prepareRegisterFile(file_item);

		const jwt = await user0.getJwt();

		//send it manually
		const res = await fetch(`http://127.0.0.1:3002/api/v1/file`, {
			body: out.server_input,
			method: "POST",
			headers: {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				"Accept": "application/json",
				"Content-Type": "application/json",
				// eslint-disable-next-line @typescript-eslint/naming-convention
				"Authorization": "Bearer " + jwt,
				"x-sentc-app-token": "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi"
			}
		}).then((res) => {
			return res.text();
		});

		const [file_id, session_id] = user0.doneFileRegister(res);

		await user0.uploadFile(file_item, out.key, session_id);

		file_1 = file_id;
	});

	it("should download the manually registered file", async function() {
		const [file_info, key] = await user0.downloadFileMetaInfo(file_1);

		const file = await user0.downloadFileWithMetaInfo(key, file_info);

		chai.assert.equal(file_info.file_name, "hello");

		/** @type Blob */
		const blob = await fetch(file).then(r => {return r.blob();});

		const arr = await blob.arrayBuffer();

		chai.assert.equal(arr.byteLength, file_test.byteLength);
	});

	it("should delete a file as owner", async function() {
		await user0.deleteFile(file_1);
	});

	it("should create a file from the sdk", async function() {
		const file_item = new File([file_test], "hello1");

		const out = await user0.createFile(file_item);

		file_2 = out.file_id;
	});

	it("should download the created file", async function() {
		const [file, file_info] = await user0.downloadFile(file_2);

		chai.assert.equal(file_info.file_name, "hello1");

		/** @type Blob */
		const blob = await fetch(file).then(r => {return r.blob();});

		const arr = await blob.arrayBuffer();

		chai.assert.equal(arr.byteLength, file_test.byteLength);
	});

	it("should delete the file as owner", async function() {
		//should work even if the user is not the creator
		await user0.deleteFile(file_2);
	});

	//to another user

	it("should create a file from the sdk for another user", async function() {
		const file_item = new File([file_test], "hello1");

		const out = await user0.createFile(file_item, false, user1.user_data.user_id);

		file_2 = out.file_id;
	});

	it("should download the created file from another user", async function() {
		const [file, file_info] = await user1.downloadFile(file_2);

		chai.assert.equal(file_info.file_name, "hello1");

		/** @type Blob */
		const blob = await fetch(file).then(r => {return r.blob();});

		const arr = await blob.arrayBuffer();

		chai.assert.equal(arr.byteLength, file_test.byteLength);
	});

	it("should delete the file as owner", async function() {
		//should work even if the user is not the creator
		await user0.deleteFile(file_2);
	});

	after(async () => {
		//clean up

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
	});
});