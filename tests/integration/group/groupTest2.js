describe("Group test 2", () => {
	const sentc = window.Sentc.default;

	/** @type Group */
	let group, group1, group2, child_group, connected_group, child_group_connected_group;

	/** @type User */
	let user0, user1, user2;

	const username0 = "test0";
	const username1 = "test1";
	const username2 = "test2";

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

		await sentc.register(username2, pw);

		user2 = await sentc.login(username2, pw);

		const group_id = await user0.createGroup();

		group = await user0.getGroup(group_id);

		const group_id1 = await user1.createGroup();

		group1 = await user1.getGroup(group_id1);

		const group_id2 = await user2.createGroup();

		group2 = await user2.getGroup(group_id2);
	});

	it("should create a connected group", async function() {
		const id = await group.createConnectedGroup();

		connected_group = await group.getConnectedGroup(id);

		chai.assert.equal(connected_group.data.group_id, id);
		chai.assert.equal(connected_group.data.access_by_group_as_member, group.data.group_id);
	});

	it("should do a key rotation in the connected group", async function() {
		const old_late_key = connected_group.data.newest_key_id;

		await connected_group.keyRotation();

		const new_late_key = connected_group.data.newest_key_id;

		chai.assert.notEqual(old_late_key, new_late_key);
	});

	it("should not access the connected group directly when user don't got direct access", async function() {
		try {
			await user0.getGroup(connected_group.data.group_id);
		} catch (e) {
			const json = JSON.parse(e);
			chai.assert.equal(json.status, "server_310");
		}
	});

	it("should access the connected group over the user class", async function() {
		const group_c = await user0.getGroup(connected_group.data.group_id, group.data.group_id);

		chai.assert.equal(group_c.data.newest_key_id, connected_group.data.newest_key_id);
		chai.assert.equal(group_c.data.access_by_group_as_member, connected_group.data.access_by_group_as_member);
	});

	it("should not get the group as member when user got no access to the connected group", async function() {
		try {
			await user1.getGroup(connected_group.data.group_id, group.data.group_id);
		} catch (e) {
			const json = JSON.parse(e);
			chai.assert.equal(json.status, "server_310");
		}
	});

	it("should create a child group from the connected group", async function() {
		const id = await connected_group.createChildGroup();

		child_group_connected_group = await connected_group.getChildGroup(id);

		chai.assert.equal(child_group_connected_group.data.group_id, id);
		chai.assert.equal(child_group_connected_group.data.access_by_group_as_member, group.data.group_id);
	});

	//Do the other tests for this connected group before
	it("should invite a user to the other group to check access to the connected group", async function() {
		await group.inviteAuto(user1.user_data.user_id);

		/** @type StorageInterface */
		const storage = await sentc.getStore();
		//delete the old caches to check access without caches

		const key = "group_data_user_" + group.data.group_id + "_id_" + child_group_connected_group.data.group_id;
		const key_1 = "group_data_user_" + group.data.group_id + "_id_" + connected_group.data.group_id;

		await storage.delete(key);
		await storage.delete(key_1);
	});

	it("should access the child group of the connected group without loading the other groups before", async function() {
		const group_c_c = await user1.getGroup(child_group_connected_group.data.group_id, group.data.group_id);

		chai.assert.equal(group_c_c.data.access_by_group_as_member, group.data.group_id);
	});

	it("should invite a group as member", async function() {
		//connect group 1 with the new group
		await connected_group.inviteGroupAuto(group2.data.group_id);
	});

	it("should access the group after invite", async function() {
		const group_c = await group2.getConnectedGroup(connected_group.data.group_id);

		chai.assert.equal(group_c.data.access_by_group_as_member, group2.data.group_id);
	});

	it("should send join req from group 2 to the new group", async function() {
		await group1.groupJoinRequest(connected_group.data.group_id);

		//get the req in the sent req list

		const joins = await group1.sentJoinReq();

		chai.assert.equal(joins.length, 1);
		chai.assert.equal(joins[0].group_id, connected_group.data.group_id);
	});

	it("should get the join req in the join req list", async function() {
		//get the join req from the list
		const joins = await connected_group.getJoinRequests();

		chai.assert.equal(joins.length, 1);
		chai.assert.equal(joins[0].user_id, group1.data.group_id);
		chai.assert.equal(joins[0].user_type, 2);
	});

	it("should reject the group join req", async function() {
		await connected_group.rejectJoinRequest(group1.data.group_id);
	});

	it("should send join again to accept it", async function() {
		await group1.groupJoinRequest(connected_group.data.group_id);
	});

	it("should accept join req", async function() {
		await connected_group.acceptJoinRequest(group1.data.group_id, 2);
	});

	it("should access the group after accepting group join req", async function() {
		const group_c = await group1.getConnectedGroup(connected_group.data.group_id);

		chai.assert.equal(group_c.data.access_by_group_as_member, group1.data.group_id);
	});

	it("should get all connected groups where the group is member", async function() {
		const list = await group1.getGroups();

		chai.assert.equal(list.length, 1);

		const pageTwo = await group1.getGroups(list[0]);

		chai.assert.equal(pageTwo.length, 0);
	});

	//TODO test delete join req from sender
	// and leave group as non group admin in the other group

	after(async () => {
		//clean up

		try {
			await group.deleteGroup();
		} catch (e) {
			console.error(e);
		}

		try {
			await group1.deleteGroup();
		} catch (e) {
			console.error(e);
		}

		try {
			await group2.deleteGroup();
		} catch (e) {
			console.error(e);
		}

		try {
			await connected_group.deleteGroup();
		} catch (e) {
			console.error(e);
		}

		try {
			await child_group_connected_group.deleteGroup();
		} catch (e) {
			console.error(e);
		}

		await user0.deleteUser(pw);
		await user1.deleteUser(pw);
		await user2.deleteUser(pw);
	});
});