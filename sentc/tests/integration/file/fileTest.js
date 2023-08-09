/**
 * File upload test
 */
describe("File test", () => {
	const file_test = new ArrayBuffer(1000 * 1000 * 4 * 3);

	const username0 = "test0";
	const username1 = "test1";

	const pw = "12345";

	/** @type User */
	let user0, user1;

	/** @type Group */
	let group, group_for_user_1;

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

	it("should create a group", async function() {
		const group_id = await user0.createGroup();

		group = await user0.getGroup(group_id);

		chai.assert.equal(group.data.group_id, group_id);
	});

	it("should invite the 2nd user in this group", async function() {
		await group.inviteAuto(user1.user_data.user_id);

		group_for_user_1 = await user1.getGroup(group.data.group_id);
	});

	it("should prepare register a file manually", async function() {
		const file_item = new File([file_test], "hello");

		const out = await group.prepareRegisterFile(file_item);

		const jwt = await user0.getJwt();

		//send it manually
		const res = await fetch(`http://127.0.0.1:3002/api/v1/group/${group.data.group_id}/file`, {
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

		const [file_id, session_id] = group.doneFileRegister(res);

		await group.uploadFile(file_item, out.key, session_id);

		file_1 = file_id;
	});

	it("should download the manually registered file", async function() {
		const [file_info, key] = await group_for_user_1.downloadFileMetaInfo(file_1);
		
		const file = await group_for_user_1.downloadFileWithMetaInfo(key, file_info);

		chai.assert.equal(file_info.file_name, "hello");

		/** @type Blob */
		const blob = await fetch(file).then(r => {return r.blob();});

		const arr = await blob.arrayBuffer();

		chai.assert.equal(arr.byteLength, file_test.byteLength);
	});

	it("should not delete the file as non owner", async function() {
		//user 2 got no permission to delete the file (not the owner and not group admin)

		try {
			await group_for_user_1.deleteFile(file_1);
		} catch (e) {
			/** @type SentcError */
			const err = JSON.parse(e);
			chai.assert.equal(err.status, "server_521");
		}
	});

	it("should delete a file as owner", async function() {
		await group.deleteFile(file_1);
	});

	it("should not fetch the deleted file", async function() {
		try {
			await group.downloadFile(file_1);
		} catch (e) {
			/** @type SentcError */
			const err = JSON.parse(e);
			chai.assert.equal(err.status, "server_512");
		}
	});

	it("should create a file from the sdk", async function() {
		const file_item = new File([file_test], "hello1");

		const out = await group_for_user_1.createFile(file_item);

		file_2 = out.file_id;
	});

	it("should download the created file", async function() {
		const [file, file_info] = await group.downloadFile(file_2);

		chai.assert.equal(file_info.file_name, "hello1");

		/** @type Blob */
		const blob = await fetch(file).then(r => {return r.blob();});

		const arr = await blob.arrayBuffer();

		chai.assert.equal(arr.byteLength, file_test.byteLength);
	});

	it("should delete the file as group owner", async function() {
		//should work even if the user is not the creator
		await group.deleteFile(file_2);
	});

	after(async () => {
		//clean up

		await group.deleteGroup();

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
	});
});