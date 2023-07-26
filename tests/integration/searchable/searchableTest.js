describe("Sortable tests", () => {
	const username0 = "test0";
	const username1 = "test1";

	const pw = "12345";

	/** @type User */
	let user0, user1;

	/** @type Group */
	let group, group_for_user_1;

	const sentc = window.Sentc.default;

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});

		await sentc.register(username0, pw);

		user0 = await sentc.login(username0, pw);

		await sentc.register(username1, pw);

		user1 = await sentc.login(username1, pw);
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

	const str = "123*+^êéèüöß@€&$ 👍 🚀 😎";
	/** @type string[] */
	let search_str_full, search_str;

	it("should create a full search str", function() {
		/** @type string[] */
		search_str_full = group.createSearchRaw(str, true);

		chai.assert.equal(search_str_full.length, 1);
	});

	it("should create searchable item", function() {
		search_str = group.createSearchRaw(str);

		chai.assert.equal(search_str.length, 39);
	});

	it("should search item", function() {
		//use the 2nd user
		const str_item = group_for_user_1.search(str);

		//should be in full
		chai.assert.equal(search_str_full[0], str_item);

		//should be in the parts
		search_str.includes(str_item);
	});

	it("should search item in parts", function() {
		const str_item = group_for_user_1.search("123");
		chai.assert.notEqual(search_str_full[0], str_item);

		search_str.includes(str_item);
	});

	after(async () => {
		//clean up

		await group.deleteGroup();

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
	});
});