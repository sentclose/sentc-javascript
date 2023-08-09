import {User} from "./User";
import {UserMfaLogin} from "./Enities";

export type LoginUser =
	| {kind: "user"; u: User}
	| {kind: "mfa"; u: UserMfaLogin};
