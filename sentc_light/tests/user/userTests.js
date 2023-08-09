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

		user = await sentc.login(username, pw, true);

		chai.assert.equal(user_id, user.user_data.user_id);
	});

	it("should change the password", async function() {
		await user.changePassword(pw, new_pw);

		//log user out
		await user.logOut();
	});

	it("should not log in with old pw", async function() {
		try {
			await sentc.login(username, pw, true);
		} catch (e) {
			chai.assert.notEqual(e, undefined);

			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_112");
		}
	});

	it("should login with the new password", async function() {
		user = await sentc.login(username, new_pw, true);
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
			await sentc.login(device_identifier, device_pw, true);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_100");
		}
	});

	it("should end the device register", async function() {
		await user.registerDevice(device_register_result);
	});

	it("should login the new device", async function() {
		new_device = await sentc.login(device_identifier, device_pw, true);
	});

	it("should register a new device", async function() {
		[device_identifier_1, device_pw_1] = sentc.generateRegisterData();

		device_register_result = await sentc.registerDeviceStart(device_identifier_1, device_pw_1);

		chai.assert.notEqual(device_register_result, false);

		//and now end register
		await user.registerDevice(device_register_result);

		new_device_1 = await sentc.login(device_identifier_1, device_pw_1, true);
	});

	it("should list all devices", async function() {
		const device_list = await user.getDevices();

		chai.assert.equal(device_list.length, 3);

		const device_list_pagination = await user.getDevices(device_list[0]);

		//order by time
		chai.assert.equal(device_list_pagination.length, 2);
	});

	it("should delete a device", async function() {
		await user.deleteDevice(new_pw, new_device_1.user_data.device_id);
	});

	it("should not log in with deleted device", async function() {
		try {
			await sentc.login(device_identifier_1, device_pw_1, true);
		} catch (e) {
			const json = JSON.parse(e);

			//device identifier not found
			chai.assert.equal(json.status, "server_100");
		}
	});

	it("should delete the user", async function() {
		await user.deleteUser(new_pw);
	});
});