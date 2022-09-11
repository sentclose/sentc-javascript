const chai = window.chai;

describe("User tests", () => {
	const username = "test";
	const pw = "12345";

	/** @var User */
	let user;

	before(async () => {
		const sentc = window.Sentc.default;

		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});
	});

	it("should check if username exists", async function() {
		const sentc = window.Sentc.default;

		const check = await sentc.checkUserIdentifierAvailable(username);

		chai.assert.equal(check, true);
	});

	it("should register and login a user", async function() {
		const sentc = window.Sentc.default;

		const user_id = await sentc.register(username, pw);

		user = await sentc.login(username, pw);

		chai.assert.equal(user_id, user.user_data.user_id);
	});

	it("should delete the user", async function() {
		await user.deleteUser(pw);
	});
});