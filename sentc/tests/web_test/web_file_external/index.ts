import Sentc, {Group, User} from "../../../src";

let user: User;
let group: Group;
let fileId;
let groupId;

const username = "userIdentifier1";
const pw = "password";

function prepareForm()
{
	window.onload = function() {
		const groupIdField = document.createElement("input");
		groupIdField.type = "text";
		groupIdField.addEventListener("change", handleGroupId, false);

		document.body.appendChild(groupIdField);

		const btn_login = document.createElement("button");
		btn_login.type = "Button";
		btn_login.innerHTML = "Login user";
		btn_login.value = "Login user";
		btn_login.addEventListener("click", login, false);

		document.body.appendChild(btn_login);

		const fileIdField = document.createElement("input");
		fileIdField.type = "text";
		fileIdField.addEventListener("change", handleFileId, false);

		document.body.appendChild(fileIdField);

		const input = document.createElement("input");
		input.type = "file";
		input.addEventListener("change", handleUpload, false);	//call function when uploading files

		document.body.appendChild(input);

		//download form
		const btn_download = document.createElement("button");
		btn_download.type = "Button";
		btn_download.innerHTML = "Download file";
		btn_download.value = "Download file";
		btn_download.addEventListener("click", download, false);

		document.body.appendChild(btn_download);
	};
}

function handleGroupId() {
	groupId = this.value;

	console.log("group id: ", groupId);
}

function handleFileId() {
	fileId = this.value;

	console.log("file id: ", fileId);
}

async function login() {
	console.log("get data");

	await Sentc.init({
		app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
		base_url: "http://127.0.0.1:3002"
		//wasm_path: "http://localhost:8000/tests/web_test/web/dist/sentc_wasm_bg.wasm"
	});

	user = await Sentc.login(username, pw, true);
	group = await user.getGroup(groupId);

	console.log("done getting data");
}

async function handleUpload()
{
	const file: File = this.files[0];

	console.log("file upload");

	const get_progress = (progress: number) => {
		console.log("Upload: " + progress);
	};

	const res = await group.createFile(file, false, get_progress);

	fileId = res.file_id;
}

async function download()
{
	const get_progress = (progress: number) => {
		console.log("Download: " + progress);
	};

	const [url, file_data, content_key] = await group.downloadFile(fileId, "", get_progress);

	const a = document.createElement("a");
	a.download = file_data.file_name;
	a.href = url;
	a.click();

	return content_key;
}

export function run()
{
	prepareForm();
}

(async () => {
	await run();
})();