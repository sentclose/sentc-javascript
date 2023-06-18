const chai = window.chai;

describe("User tests", () => {
	const username = "test";
	const pw = "12345";
	const new_pw = "12";

	/** @type User */
	let user;

	const sentc = window.Sentc.default;

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});
	});

	it("should check if username exists", async function() {
		const check = await sentc.checkUserIdentifierAvailable(username);

		chai.assert.equal(check, true);
	});

	it("should register and login a user", async function() {
		const user_id = await sentc.register(username, pw);

		user = await sentc.login(username, pw);

		chai.assert.equal(user_id, user.user_data.user_id);
	});

	it("should change the password", async function() {
		await user.changePassword(pw, new_pw);

		//log user out
		await user.logOut();
	});

	it("should not log in with old pw", async function() {
		try {
			await sentc.login(username, pw);
		} catch (e) {
			chai.assert.notEqual(e, undefined);

			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_112");
		}
	});

	it("should login with the new password", async function() {
		user = await sentc.login(username, new_pw);
	});

	it("should reset password", async function() {
		await user.resetPassword(pw);

		await user.logOut();
	});

	it("should not login with the new password after reset", async function() {
		try {
			await sentc.login(username, new_pw);
		} catch (e) {
			chai.assert.notEqual(e, undefined);

			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_112");
		}
	});

	it("should login with the new password after reset", async function() {
		user = await sentc.login(username, pw);
	});

	//device test
	let device_identifier, device_pw;
	let device_identifier_1, device_pw_1;
	let device_register_result;

	/** @type User */
	let new_device;
	/** @type User */
	let new_device_1;

	it("should register new device", async function() {
		[device_identifier, device_pw] = sentc.generateRegisterData();

		device_register_result = await sentc.registerDeviceStart(device_identifier, device_pw);

		chai.assert.notEqual(device_register_result, false);
	});

	it("should not login with a not fully registered device", async function() {
		try {
			await sentc.login(device_identifier, device_pw);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_112");
		}
	});

	it("should end the device register", async function() {
		await user.registerDevice(device_register_result);
	});

	it("should login the new device", async function() {
		new_device = await sentc.login(device_identifier, device_pw);
	});

	//device key rotation
	it("should start the key rotation", async function() {
		await user.keyRotation();
	});

	it("should finish the key rotation on the other device", async function() {
		//test also if the newest key id changed after rotation, because a new user key is set
		const old_newest_key = new_device.user_data.newest_key_id;

		await new_device.finishKeyRotation();

		const new_newest_key = new_device.user_data.newest_key_id;

		chai.assert.notEqual(old_newest_key, new_newest_key);
	});

	it("should register a new device after key rotation (with multiple keys)", async function() {
		[device_identifier_1, device_pw_1] = sentc.generateRegisterData();

		device_register_result = await sentc.registerDeviceStart(device_identifier_1, device_pw_1);

		chai.assert.notEqual(device_register_result, false);

		//and now end register
		await user.registerDevice(device_register_result);

		new_device_1 = await sentc.login(device_identifier_1, device_pw_1);
	});

	it("should get the same key id for all devices", function() {
		const newest_key = user.user_data.newest_key_id;
		const newest_key_1 = new_device.user_data.newest_key_id;
		const newest_key_2 = new_device_1.user_data.newest_key_id;
		
		chai.assert.equal(newest_key, newest_key_1);
		chai.assert.equal(newest_key, newest_key_2);
	});

	it("should list all devices", async function() {
		const device_list = await user.getDevices();

		chai.assert.equal(device_list.length, 3);

		const device_list_pagination = await user.getDevices(device_list[0]);

		//order by time
		chai.assert.equal(device_list_pagination.length, 2);
	});

	it("should delete a device", async function() {
		await user.deleteDevice(pw, new_device_1.user_data.device_id);
	});

	it("should not log in with deleted device", async function() {
		try {
			await sentc.login(device_identifier_1, device_pw_1);
		} catch (e) {
			const json = JSON.parse(e);

			//device identifier not found
			chai.assert.equal(json.status, "server_100");
		}
	});

	it("should create a safety number", async function() {
		await user.createSafetyNumber();
	});

	/** @type User */
	let user_2, user_3;

	it("should create a combined safety number", async function() {
		//first register new user
		await sentc.register(username + "1", pw);
		user_2 = await sentc.login(username + "1", pw);

		const number = await user.createSafetyNumber({
			user_id: user_2.user_data.user_id,
			verify_key_id: user_2.getNewestKey().group_key_id
		});

		const number_2 = await user_2.createSafetyNumber({
			user_id: user.user_data.user_id,
			verify_key_id: user.getNewestKey().group_key_id
		});

		//always the same user number
		chai.assert.equal(number, number_2);
	});

	it("should not create the same number with different users", async function() {
		await sentc.register(username + "2", pw);
		user_3 = await sentc.login(username + "2", pw);

		const number = await user.createSafetyNumber({
			user_id: user_2.user_data.user_id,
			verify_key_id: user_2.getNewestKey().group_key_id
		});

		const number_2 = await user_2.createSafetyNumber({
			user_id: user.user_data.user_id,
			verify_key_id: user.getNewestKey().group_key_id
		});

		//always the same user number
		chai.assert.equal(number, number_2);

		const number_3 = await user_3.createSafetyNumber({
			user_id: user.user_data.user_id,
			verify_key_id: user.getNewestKey().group_key_id
		});

		chai.assert.notEqual(number, number_3);

		const number_4 = await user.createSafetyNumber({
			user_id: user_3.user_data.user_id,
			verify_key_id: user_3.getNewestKey().group_key_id
		});

		chai.assert.equal(number_3, number_4);
	});

	it("should verify a public key", async function() {
		const user_id = user_2.user_data.user_id;

		//first remove the cached public key from the store of user 2 because after login the public key will be set as verified true

		/** @type StorageInterface */
		const storage = await sentc.getStore();
		const store_key =  "user_public_key_id_" + user_id;
		await storage.delete(store_key);

		const public_key = await sentc.getUserPublicKey(user_id);
		
		const verify = await sentc.verifyUserPublicKey(user_id, public_key);

		chai.assert.equal(verify, true);
	});

	//encrypt tests
	const string = "hello there £ Я a a";
	let encryptedString;

	it("should encrypt string data for another user", async function() {
		encryptedString = await user.encryptString(string, user_2.user_data.user_id);

		//should not decrypt it again
		try {
			await user.decryptString(encryptedString);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_304");
		}
	});

	it("should decrypt the string for the other user", async function() {
		const decrypted = await user_2.decryptString(encryptedString);

		chai.assert.equal(decrypted, string);
	});

	it("should encrypt string with sign", async function() {
		encryptedString = await user.encryptString(string, user_2.user_data.user_id, true);
	});

	it("should decrypt the signed string without verify", async function() {
		const decrypted = await user_2.decryptString(encryptedString);

		chai.assert.equal(decrypted, string);
	});

	it("should decrypt the string with verify", async function() {
		const decrypted = await user_2.decryptString(encryptedString, true, user.user_data.user_id);

		chai.assert.equal(decrypted, string);
	});

	it("should delete the user", async function() {
		await user.deleteUser(pw);
		await user_2.deleteUser(pw);
		await user_3.deleteUser(pw);
	});
});