//with generated key

const chai = window.chai;

describe("Sortable test with generated key", () => {

	const sentc = window.Sentc.default;

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});
	});

	it("should generate the same numbers with same key", function() {
		//dummy group
		const group = new window.Sentc.Group({
			sortable_keys: [`{"Ope16":{"key":"5kGPKgLQKmuZeOWQyJ7vOg==","key_id":"1876b629-5795-471f-9704-0cac52eaf9a1"}}`]
		}, "", "", null);

		const a = group.encryptSortableRawNumber(262);
		const b = group.encryptSortableRawNumber(263);
		const c = group.encryptSortableRawNumber(65321);

		// eslint-disable-next-line no-console
		console.log(`a: ${a}, b: ${b}, c: ${c}`);

		chai.assert.equal((a < b), true);
		chai.assert.equal((b < c), true);
	});
});