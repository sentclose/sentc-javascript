describe("Group test 2", () => {
	const sentc = window.Sentc.default;

	/** @type Group */
	let group, group1, group2;

	/** @type User */
	let user0, user1;

	const username0 = "test0";
	const username1 = "test1";

	const pw = "12345";

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});

		await sentc.register(username0, pw);

		user0 = await sentc.login(username0, pw);

		await sentc.register(username1, pw);

		user1 = await sentc.login(username1, pw);

		const group_id = await user0.createGroup();

		group = await user0.getGroup(group_id);

		const group_id1 = await user1.createGroup();

		group1 = await user1.getGroup(group_id1);

		const group_id2 = await user0.createGroup();

		group2 = await user0.getGroup(group_id2);
	});

	it("should invite a group as member", function() {
		//TODO
		chai.assert.equal(true, true);
	});

	after(async () => {
		//clean up

		await group.deleteGroup();
		await group1.deleteGroup();
		await group2.deleteGroup();

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
	});
});