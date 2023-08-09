describe("User tests", () => {
	const username = "test";
	const pw = "12345";

	/** @type User */
	let user;

	const sentc = window.Sentc.default;

	before(async () => {
		await sentc.init({
			app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi",
			base_url: "http://127.0.0.1:3002"
		});

		await sentc.register(username, pw);

		user = await sentc.login(username, pw, true);
	});

	let sec, recovery_keys;

	it("should register otp", async function() {
		const out = await user.registerRawOtp(pw);

		sec = out.secret;
		recovery_keys = out.recover;
	});

	it("should not login without otp", async function() {
		//no force here
		const u = await sentc.login(username, pw);

		const mfa = u.kind === "mfa";

		chai.assert.equal(mfa, true);
	});

	it("should login with otp", async function() {
		const u = await sentc.login(username, pw);

		if (u.kind === "mfa") {
			//mfa login
			const token = getToken(sec, {
				algorithm: "SHA-256"
			});

			const u1 = await sentc.mfaLogin(token, u.u);

			chai.assert.equal(u1.user_data.mfa, true);
		} else {
			chai.assert.equal(false, true, "Should not return the user object");
		}
	});

	it("should get all recover keys", async function() {
		const token = getToken(sec, {
			algorithm: "SHA-256"
		});

		const keys = await user.getOtpRecoverKeys(pw, token, false);

		chai.assert.equal(keys.length, 6);
	});

	it("should login with otp recover keys", async function() {
		const u = await sentc.login(username, pw);

		if (u.kind === "mfa") {
			const u1 = await sentc.mfaRecoveryLogin(recovery_keys[0], u.u);

			chai.assert.equal(u1.user_data.mfa, true);
		} else {
			chai.assert.equal(false, true, "Should not return the user object");
		}
	});

	it("should get one recover key less", async function() {
		const token = getToken(sec, {
			algorithm: "SHA-256"
		});

		const keys = await user.getOtpRecoverKeys(pw, token, false);

		chai.assert.equal(keys.length, 5);
	});

	it("should reset otp", async function() {
		const token = getToken(sec, {
			algorithm: "SHA-256"
		});

		const out = await user.resetRawOtp(pw, token, false);

		sec = out.secret;
		recovery_keys = out.recover;
	});

	it("should get all keys back", async function() {
		const token = getToken(sec, {
			algorithm: "SHA-256"
		});

		const keys = await user.getOtpRecoverKeys(pw, token, false);

		chai.assert.equal(keys.length, 6);
	});

	it("should disable otp", async function() {
		const token = getToken(sec, {
			algorithm: "SHA-256"
		});

		await user.disableOtp(pw, token, false);
	});

	it("should login without otp after disabled", async function() {
		//no force here
		const u = await sentc.login(username, pw);

		const mfa = u.kind === "user";

		chai.assert.equal(mfa, true);
	});

	after(async () => {
		//clean up
		await user.deleteUser(pw);
	});
});

//other js fn
//browser version of: https://github.com/bellstrand/totp-generator/tree/master
function getToken(key, options) {
	options = options || {};
	let epoch, time, shaObj, hmac, offset, otp;
	options.period = options.period || 30;
	options.algorithm = options.algorithm || "SHA-1";
	options.digits = options.digits || 6;
	options.timestamp = options.timestamp || Date.now();
	key = base32tohex(key);
	// eslint-disable-next-line prefer-const
	epoch = Math.floor(options.timestamp / 1000.0);
	// eslint-disable-next-line prefer-const
	time = leftpad(dec2hex(Math.floor(epoch / options.period)), 16, "0");
	// eslint-disable-next-line prefer-const
	shaObj = new window.jsSHA(options.algorithm, "HEX");
	shaObj.setHMACKey(key, "HEX");
	shaObj.update(time);
	// eslint-disable-next-line prefer-const
	hmac = shaObj.getHMAC("HEX");
	// eslint-disable-next-line prefer-const
	offset = hex2dec(hmac.substring(hmac.length - 1));
	otp = (hex2dec(hmac.substr(offset * 2, 8)) & hex2dec("7fffffff")) + "";
	otp = otp.substr(Math.max(otp.length - options.digits, 0), options.digits);
	return otp;
}

function hex2dec(s) {
	return parseInt(s, 16);
}

function dec2hex(s) {
	return (s < 15.5 ? "0" : "") + Math.round(s).toString(16);
}

function base32tohex(base32) {
	// eslint-disable-next-line prefer-const
	let base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
		bits = "",
		hex = "";

	base32 = base32.replace(/=+$/, "");

	for (let i = 0; i < base32.length; i++) {
		const val = base32chars.indexOf(base32.charAt(i).toUpperCase());
		if (val === -1) {throw new Error("Invalid base32 character in key");}
		bits += leftpad(val.toString(2), 5, "0");
	}

	for (let i = 0; i + 8 <= bits.length; i += 8) {
		const chunk = bits.substr(i, 8);
		hex = hex + leftpad(parseInt(chunk, 2).toString(16), 2, "0");
	}
	return hex;
}

function leftpad(str, len, pad) {
	if (len + 1 >= str.length) {
		str = Array(len + 1 - str.length).join(pad) + str;
	}
	return str;
}
