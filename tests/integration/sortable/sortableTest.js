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

	let a, b, c;
	
	it("should encrypt a number", function() {
		a = group.encryptSortableRawNumber(262);
		b = group.encryptSortableRawNumber(263);
		c = group.encryptSortableRawNumber(65321);

		chai.assert.equal((a < b), true);
		chai.assert.equal((b < c), true);
	});

	it("should get the same numbers as result back", function() {
		const a1 = group_for_user_1.encryptSortableRawNumber(262);
		const b1 = group_for_user_1.encryptSortableRawNumber(263);
		const c1 = group_for_user_1.encryptSortableRawNumber(65321);

		chai.assert.equal((a1 < b1), true);
		chai.assert.equal((b1 < c1), true);

		chai.assert.equal(a, a1);
		chai.assert.equal(b, b1);
		chai.assert.equal(c, c1);
	});

	after(async () => {
		//clean up

		await group.deleteGroup();

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
	});
});