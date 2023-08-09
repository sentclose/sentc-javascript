describe("Group Test", () => {
	const username0 = "test0";
	const username1 = "test1";
	const username2 = "test2";
	const username3 = "test3";

	const pw = "12345";

	/** @type User */
	let user0, user1, user2, user3;

	/** @type Group */
	let group, group_for_user_1, group_for_user_2, child_group, child_group_user_2, child_group_user_3;

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

		await sentc.register(username2, pw);

		user2 = await sentc.login(username2, pw, true);

		await sentc.register(username3, pw);

		user3 = await sentc.login(username3, pw, true);
	});

	it("should create a group", async function() {
		const group_id = await user0.createGroup();

		group = await user0.getGroup(group_id);

		chai.assert.equal(group.data.group_id, group_id);
	});

	it("should get all groups for the user", async function() {
		/** @type GroupList[] */
		const out = await user0.getGroups();

		chai.assert.equal(out.length, 1);
	});

	it("should not get the group when user is not in the group", async function() {
		try {
			await user1.getGroup(group.data.group_id);
		} catch (e) {
			const error = JSON.parse(e);

			chai.assert.equal(error.status, "server_310");
		}
	});

	it("should invite the 2nd user in this group", async function() {
		await group.invite(user1.user_data.user_id);
	});

	it("should get the invite for the 2nd user", async function() {
		const list = await user1.getGroupInvites();

		chai.assert.equal(list.length, 1);

		chai.assert.equal(list[0].group_id, group.data.group_id);

		//2nd page test

		const list_2 = await user1.getGroupInvites(list[0]);

		chai.assert.equal(list_2.length, 0);
	});

	it("should reject the invite", async function() {
		await user1.rejectGroupInvite(group.data.group_id);

		//should not get the group in the invite list
		const list = await user1.getGroupInvites();

		chai.assert.equal(list.length, 0);
	});

	it("should invite the user again to accept the invite", async function() {
		await group.invite(user1.user_data.user_id);
	});

	it("should accept the invite", async function() {
		const list = await user1.getGroupInvites();

		await user1.acceptGroupInvite(list[0].group_id);
	});

	it("should fetch the group for the 2nd user", async function() {
		/** @type GroupList[] */
		const out = await user1.getGroups();

		chai.assert.equal(out.length, 1);

		group_for_user_1 = await user1.getGroup(out[0].group_id);

		chai.assert.equal(group_for_user_1.data.group_id, group.data.group_id);
	});

	it("should leave the group", async function() {
		await group_for_user_1.leave();

		/** @type GroupList[] */
		const out = await user1.getGroups();

		chai.assert.equal(out.length, 0);
	});

	it("should auto invite the 2nd user", async function() {
		await group.inviteAuto(user1.user_data.user_id);
	});

	it("should fetch the group after auto invite", async function() {
		/** @type GroupList[] */
		const out = await user1.getGroups();

		chai.assert.equal(out.length, 1);

		group_for_user_1 = await user1.getGroup(out[0].group_id);
		chai.assert.equal(group_for_user_1.data.group_id, group.data.group_id);
	});

	//join req (and join req list for sent and received)
	it("should send join req to the group", async function() {
		await user2.groupJoinRequest(group.data.group_id);
	});

	it("should get the sent join req for the group", async function() {
		const list = await group.getJoinRequests();

		chai.assert.equal(list.length, 1);
		chai.assert.equal(list[0].user_id, user2.user_data.user_id);

		//pagination
		const list_1 = await group.getJoinRequests(list[0]);

		chai.assert.equal(list_1.length, 0);
	});

	it("should get the sent join req for the user", async function() {
		const list = await user2.sentJoinReq();

		chai.assert.equal(list.length, 1);
		chai.assert.equal(list[0].group_id, group.data.group_id);

		//pagination
		const list_1 = await user2.sentJoinReq(list[0]);

		chai.assert.equal(list_1.length, 0);
	});

	it("should not reject the join req without the rights", async function() {
		try {
			await group_for_user_1.rejectJoinRequest(user2.user_data.user_id);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "client_201");
		}
	});

	it("should reject the join req", async function() {
		await group.rejectJoinRequest(user2.user_data.user_id);
	});

	it("should send the join req again", async function() {
		await user2.groupJoinRequest(group.data.group_id);
	});

	it("should not accept join req without rights", async function() {
		try {
			await group_for_user_1.acceptJoinRequest(user2.user_data.user_id);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "client_201");
		}
	});

	it("should accept the join req", async function() {
		const list = await group.getJoinRequests();

		chai.assert.equal(list.length, 1);

		await group.acceptJoinRequest(list[0].user_id);
	});

	it("should get the group data for the 3rd user", async function() {
		group_for_user_2 = await user2.getGroup(group.data.group_id);
	});

	it("should increase the rank for user 1", async function() {
		await group.updateRank(user1.user_data.user_id, 1);

		//get the new group data for user 2 to get the new rank
		await group_for_user_1.groupUpdateCheck();

		await group.updateRank(user2.user_data.user_id, 2);

		await group_for_user_2.groupUpdateCheck();
	});

	it("should not kick a user with higher rank", async function() {
		try {
			await group_for_user_2.kickUser(user1.user_data.user_id);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_316");
		}
	});

	it("should kick a user", async function() {
		await group_for_user_1.kickUser(user2.user_data.user_id);
	});

	it("should not get the group data after user was kicked", async function() {
		try {
			await user2.getGroup(group.data.group_id);
		} catch (e) {
			const json = JSON.parse(e);

			chai.assert.equal(json.status, "server_310");
		}
	});

	//child group

	it("should create a child group", async function() {
		const id = await group.createChildGroup();

		//get the child in the list
		const list = await group.getChildren();

		chai.assert.equal(list.length, 1);
		chai.assert.equal(list[0].group_id, id);

		const pageTwo = await group.getChildren(list[0]);

		chai.assert.equal(pageTwo.length, 0);

		child_group = await group.getChildGroup(id);
	});

	it("should get the child group as member of the parent group", async function() {
		await group_for_user_1.getChildGroup(child_group.data.group_id);
	});

	it("should invite a user to the child group", async function() {
		//test here also the rank
		await child_group.inviteAuto(user2.user_data.user_id, 2);

		child_group_user_2 = await user2.getGroup(child_group.data.group_id);
		chai.assert.equal(child_group_user_2.data.rank, 2);
	});

	it("should get the child group by direct access", async function() {
		//access the child group by user not by parent group -> the parent should be loaded too

		//auto invite the user to the parent!
		await group.inviteAuto(user3.user_data.user_id);

		//this should work because the parent is fetched before the child is fetched
		child_group_user_3 = await user3.getGroup(child_group.data.group_id);
	});

	after(async () => {
		//clean up

		await group.deleteGroup();

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
		await user2.deleteUser(pw);
		await user3.deleteUser(pw);
	});
});