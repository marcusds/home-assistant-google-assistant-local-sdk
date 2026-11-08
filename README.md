# Google Local SDK for Home Assistant

Implements a small Local SDK receiver that can interact with Home Assistant instances.

## Home Assistant instance requirements

- Zeroconf integration so it can be discovered
- Google Assistant with local SDK activated

## Set up Google dev env

Go to the [Google Home Developer Console](https://console.home.google.com/), open your cloud-to-cloud integration and set up local fulfillment:

  - Enter your testing URL for Chrome: `http://<YOUR LOCAL IP>:8081/test_receiver.html`
  - Enter your testing URL for Node: `http://<YOUR LOCAL IP>:8081/test_receiver.html`
  - Enable "Support local query"
  - Add device scan configuration: "MDNS"
  - MDNS service name: `_home-assistant._tcp.local`
  - Name: `.*\._home-assistant\._tcp\.local`

## Local SDK dev env

Requires Node.js 24 (see `.nvmrc`). A devcontainer (`.devcontainer.json`) is also provided.

1. Install dependencies `npm install` (only do it whenever you pull latest code)
2. Build code `npm run build` to build the code once or run `npm run watch` if you're developing and want to generate a new build whenever you make a change.
3. Run `npm run server` to allow Google Assistant to load the app (serves on port 8081)
4. Run `npm test` to build and run the tests against a mocked Local Home SDK

## Chrome debugging

1. In Chrome, navigate to [chrome://inspect](chrome://inspect)
2. Click "inspect" on the test receiver to open the debugger.

## Home Assistant dev env

1. Make sure you have both `zeroconf` and `cloud` integrations set up.
2. Log in to Home Assistant Cloud
3. Sync your entities with Google Assistant
4. Restart Home Assistant to trigger identify requests to the local SDK

## Resources

- [Local fulfillment guide](https://developers.home.google.com/local-home/overview)
- [Local SDK types](https://github.com/actions-on-google/local-home-sdk)
- [Sample app](https://github.com/actions-on-google/smart-home-local/tree/master/app)
