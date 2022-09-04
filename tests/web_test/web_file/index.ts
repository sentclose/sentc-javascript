import Sentc, {Group, User, SymKey, FileMetaInformation} from "../../../src";

let user: User;
let user_2: User;
let group: Group;
let group_for_user_2: Group;

function prepareForm()
{
	window.onload = function() {
		const input = document.createElement("input");

		input.type = "file";
		input.addEventListener("change", handleUpload, false);	//call function when uploading files

		document.body.appendChild(input);

		//delete form
		const btn = document.createElement("button");
		btn.type = "Submit";
		btn.name = "End test";
		btn.value = "End test";
		btn.addEventListener("click", endTest, false);

		document.body.appendChild(btn);
	};
}

async function handleUpload()
{
	const file: File = this.files[0];

	console.log("_________________________________________");
	console.log("file upload for user");

	const get_progress = (progress: number) => {
		console.log("Upload: " + progress);
	};

	const {file_id: file_id_1, master_key_id: master_key_id_1} = await user.createFile(file, false, "", get_progress);

	console.log("_________________________________________");
	console.log("download file for user");

	await downloadFile(file_id_1, master_key_id_1, 0, 1);

	console.log("_________________________________________");
	console.log("file upload to other user");

	const {file_id: file_id_2,  master_key_id: master_key_id_2} = await user.createFile(file, false, user_2.user_data.user_id, get_progress);

	console.log("_________________________________________");
	console.log("get file for the other user");

	await downloadFile(file_id_2, master_key_id_2, 0, 2);

	console.log("_________________________________________");
	console.log("upload file for group");

	const {file_id: file_id_3, master_key_id: master_key_id_3} = await group.createFile(file);

	console.log("_________________________________________");
	console.log("download group file for user 1");

	await downloadFile(file_id_3, master_key_id_3, 1);

	console.log("_________________________________________");
	console.log("download group file for user 2");

	await downloadFile(file_id_3, master_key_id_3, 2);

	console.log("_________________________________________");
}

async function downloadFile(file_id: string, master_key_id: string, group_for_user = 0, selected_user = 0)
{
	const get_progress = (progress: number) => {
		console.log("Download: " + progress);
	};

	let url: string, file_data: FileMetaInformation, content_key: SymKey;

	if (group_for_user === 1) {
		[url, file_data, content_key] = await group.downloadFile(file_id, master_key_id, "", get_progress);
	}

	if (group_for_user === 2) {
		[url, file_data, content_key] = await group_for_user_2.downloadFile(file_id, master_key_id, "", get_progress);
	}

	if (selected_user === 1) {
		[url, file_data, content_key] = await user.downloadFile(file_id, master_key_id, "", get_progress);
	}

	if (selected_user === 2) {
		[url, file_data, content_key] = await user_2.downloadFile(file_id, master_key_id, "", get_progress);
	}

	const a = document.createElement("a");
	a.download = file_data.file_name;
	a.href = url;
	a.click();

	return content_key;
}

async function endTest()
{
	console.log("___________________________________________________________________________");
	console.log("ending the test");
	
	const pw = "hello";

	if (group) {
		await group.deleteGroup();
	}

	console.log("user delete");

	if (user) {
		await user.deleteUser(pw);
	}

	if (user_2) {
		await user_2.deleteUser(pw);
	}
}

export async function run()
{
	prepareForm();

	const username = "admin";
	const username_2 = "admin1";
	const pw = "hello";

	console.log("prepare");

	await Sentc.init({
		app_token: "RKXSJBwZu9Wrql3zyHxKkm3AbUqKrlpO2UU2XDBn",
		base_url: "http://127.0.0.1:3002"
		//wasm_path: "http://localhost:8000/tests/web_test/web/dist/sentc_wasm_bg.wasm"
	});

	await Sentc.register(username, pw);

	console.log("login");

	user = await Sentc.login(username, pw);

	await Sentc.register(username_2, pw);

	user_2 = await Sentc.login(username_2, pw);

	const group_id = await user.createGroup();

	group = await user.getGroup(group_id);

	try {
		await group.invite(user_2.user_data.user_id);

		const invites = await user_2.getGroupInvites();

		for (let i = 0; i < invites.length; i++) {
			const invite = invites[i];

			// eslint-disable-next-line no-await-in-loop
			await user_2.acceptGroupInvite(invite.group_id);
		}

		group_for_user_2 = await user_2.getGroup(group_id);
	} catch (e) {
		console.error(e);
	}
}

(async () => {
	await run();
})();