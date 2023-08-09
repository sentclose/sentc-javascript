# Sentc Javascript SDK

from sentclose.

End-to-end encryption as a service.

Sentc is an easy to use end-to-end encryption sdk. It can be used for any kind of data.

## Example from CDN

The scripts can be downloaded from any CDN provider. 

````html
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Sentc example</title>
</head>
<body>
    <script src="https://cdn.jsdelivr.net/npm/@sentclose/sentc/dist/sentc.min.js"></script>

    <script>
        //init the wasm
        const sentc = window.Sentc.default;

        async function run() {
            //use your public token as the app token.
            // if a user is already logged in, this function will return the logged-in user
            await sentc.init({
                app_token: "5zMb6zs3dEM62n+FxjBilFPp+j9e7YUFA+7pi6Hi"
            });
			
            //now you are ready to go
            //register a user:
            await sentc.register("username", "password");
			
            //log in a user
            const user = await sentc.login("username", "password");
			
            //create a group
            const group_id = await user.createGroup();
			
            //load a group. returned a group obj for every user.
            const group = await user.getGroup(group_id);
			
            //invite a user to a group. use the sentc user id
            await group.invite("user_id_of_the_other_user");
			
            //encrypt a string for the group
            const encrypted_string = await group.encryptString("hello there!");
			
            //now every user in the group can decrypt the string
            const decrypted_string = await group.decryptString(encrypted_string);
			
            console.log(decrypted_string);  //hello there!
        }
		
        run();
    </script>
</body>
</html>
````