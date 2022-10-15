import Sentc, {Group} from "../../../src";

export async function run()
{
	//app public token: 5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi
	//app sec token: BNM76kOdUSVBGV8iBNRRnjMXNwv5hpGlaUDZhE5aKPGh1U0aa6uYxMUMtd2AHjj6OmQ=

	await Sentc.init({
		app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
		base_url: "http://127.0.0.1:3002"
		//wasm_path: "http://localhost:8000/tests/web_test/web/dist/sentc_wasm_bg.wasm"
	});

	console.log("_________________________________");

	console.log("prepare fn");

	const username = "admin";
	const username_2 = "admin1";
	const pw = "hello";

	console.log("prepare check username");

	const check_username_out = Sentc.prepareCheckUserIdentifierAvailable(username);

	console.log(check_username_out);

	console.log("register user");
	const register_out = Sentc.prepareRegister(username, pw);

	console.log(register_out);

	console.log("_________________________________");

	console.log("real usage");

	console.log("check username");

	const check = await Sentc.checkUserIdentifierAvailable(username);

	if (!check) {
		throw new Error("Username found");
	}

	await Sentc.register(username, pw);

	console.log("login");

	const user = await Sentc.login(username, pw);

	console.log("login user 2");

	await Sentc.register(username_2, pw);

	const user_2 = await Sentc.login(username_2, pw);

	console.log("create and get group");

	const group_id = await user.createGroup();

	const group = await user.getGroup(group_id);

	console.log("test encrypt with std group key");

	const encrypted_by_user_1 = await group.encryptString("hello there £ Я a a 👍");

	let group_for_user_2: Group;

	try {
		console.log("invite user");

		await group.invite(user_2.user_data.user_id);

		console.log("accept group invite");

		const invites = await user_2.getGroupInvites();

		for (let i = 0; i < invites.length; i++) {
			const invite = invites[i];

			// eslint-disable-next-line no-await-in-loop
			await user_2.acceptGroupInvite(invite.group_id);
		}

		console.log("get group for the 2nd user");

		group_for_user_2 = await user_2.getGroup(group_id);

		console.log("group key rotation");

		await group.keyRotation();

		console.log("get group keys after rotation for user 1");

		console.log(group.data);

		console.log("finish the key rotation for user 2");
		await group_for_user_2.finishKeyRotation();

		console.log("get group keys after rotation for user 2");

		console.log(group_for_user_2.data);

		console.log("test decrypt with older key");

		const decrypted_user_2 = await group_for_user_2.decryptString(encrypted_by_user_1);

		console.log("encrypt result: ", decrypted_user_2);

		//encrypt and decrypt with sign

		const encrypted_by_user_1_sign = await group.encryptString("hello there £ Я a a 👍", true);

		const decrypted_user_2_sign = await group_for_user_2.decryptString(encrypted_by_user_1_sign, true, user.user_data.user_id);

		console.log("encrypt result with sign: ", decrypted_user_2_sign);

		//try test with wrong verify

		try {
			await group_for_user_2.decryptString(encrypted_by_user_1_sign, true, user_2.user_data.user_id);
			
			console.log("should be an error");
		} catch (e) {
			console.log("wrong verify should be an error: ", e);
		}

		// eslint-disable-next-line no-empty
	} catch (e) {
		console.error(e);
	}

	console.log("member of group");
	const member = await group.getMember();
	console.log(member);

	const member_user_2 = await group_for_user_2.getMember();
	console.log(member_user_2);

	try {
		console.log("create and get child group");
		
		const child_group_id = await group.createChildGroup();

		//both get the child group and should test key rotation
		const child_group = await group.getChildGroup(child_group_id);

		const child_group_user_2 = await group_for_user_2.getChildGroup(child_group_id);

		console.log("key rotation in child group");
		//done key rotation is not needed for the 2nd user because he got already the keys from parent
		await child_group.keyRotation();

		console.log("test encrypt after key rotation in child group");

		const encrypted_by_user_1 = await child_group.encryptString("hello there £ Я a a");

		const decrypted_user_2 = await child_group_user_2.decryptString(encrypted_by_user_1);

		console.log("encrypt result: ", decrypted_user_2);

		console.log("member of child group");
		const member = await child_group.getMember();
		console.log(member);

		const member_user_2 = await child_group_user_2.getMember();
		console.log(member_user_2);
	} catch (e) {
		console.log(e);
	}

	console.log("get groups for user");

	const groups_user_1 = await user.getGroups();
	const groups_user_2 = await user_2.getGroups();

	console.log("groups user 1", groups_user_1);
	console.log("groups user 2", groups_user_2);

	try {
		console.log("add device");
		//add and delete device
		const [device_identifier, device_pw] = Sentc.generateRegisterData();

		//transform this data to the main device to add it. in this case it is the user obj
		const result = await Sentc.registerDeviceStart(device_identifier, device_pw);

		if (result === false) {
			console.log("Failed to add device");
			return;
		}

		await user.registerDevice(result);

		//now try to log in with the new device
		const new_device = await Sentc.login(device_identifier, device_pw);

		console.log(new_device);

		console.log("___________________________________________________");
		console.log("device key rotation");

		await user.keyRotation();

		console.log("finish key rotation for other device");

		await new_device.finishKeyRotation();

		console.log("___________________________________________________");
		console.log("Log device out");

		await new_device.logOut();

		console.log("___________________________________________________");
		console.log("get all devices");

		const device_list = await user.getDevices();

		console.log(device_list);

		const device_list_pagination = await user.getDevices(device_list[0]);

		console.log(device_list_pagination);

		console.log("___________________________________________________");
		console.log("remove the device from the main device");

		await user.deleteDevice(pw, new_device.user_data.device_id);

		console.log("should not login with a deleted device");

		try {
			await Sentc.login(device_identifier, device_pw);
			console.log("logged in with deleted device. Not good!");
		} catch (e) {
			console.log("not logged in with deleted device");
		}
	} catch (e) {
		console.log(e);
	}

	console.log("group stop invites");

	await group.stopInvites();

	console.log("group start invite");

	await group.stopInvites();

	console.log("group delete");

	await group.deleteGroup();

	console.log("user delete");
	await user.deleteUser(pw);
	await user_2.deleteUser(pw);
}

(async () => {
	await run();
})();