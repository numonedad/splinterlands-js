window.steem = window.hive;

var splinterlands = (function() {
	let _config = {};
	let _player = null;
	let _settings = {};
	let _cards = [];
	let _market = [];
	let _potions = [];
	let _use_keychain = false;
	let _transactions = {};
	let _collection = [];
	let _browser_id = null;
	let _session_id = null;
	let _match = null;
	let _url = null;
	let _init_url_search_params = null; //Query string app started with
	let _server_time_offset = 0;

	async function init(config) { 
		_config = config;

		if(!_config.ec_api_url) {
			_config.ec_api_url = "https://ec-api.splinterlands.com"
		}

		steem.api.setOptions({ transport: 'http', uri: 'https://api.hive.blog', url: 'https://api.hive.blog' });

		// Load the browser id and create a new session id
		_browser_id = localStorage.getItem('splinterlands:browser_id');
		_session_id = 'msid_' + splinterlands.utils.randomStr(20);

		// Create a new browser id if one is not already set
		if(!_browser_id) {
			_browser_id = 'mbid_' + splinterlands.utils.randomStr(20);
			localStorage.setItem('splinterlands:browser_id', _browser_id);
		}

		// Load the game settings
		await load_settings();
		setInterval(load_settings, 60 * 1000);

		// Load the card details
		_cards = (await api('/cards/get_details')).map(c => new splinterlands.CardDetails(c));

		// Load market data
		await load_market();

		//hack to handle Angular query string issues
		let urlHash = (window.location.hash) ? window.location.hash : window.location.search ;
		_init_url_search_params = new URLSearchParams(urlHash.substring(urlHash.indexOf('?')));	

		// Init MetaMask library
		if (window.ethereum) {
			window.web3 = new Web3(window.ethereum);
		}

		let rpc_list = splinterlands.get_settings().rpc_nodes;

		if(rpc_list && Array.isArray(rpc_list) && rpc_list.length > 0) {
			splinterlands.utils.set_rpc_nodes(rpc_list);
			steem.api.setOptions({ transport: 'http', uri: rpc_list[0], url: rpc_list[0] });
			console.log(`Set Hive RPC node to: ${rpc_list[0]}`);
		}

		//Snapyr Init
		snapyr = window.snapyr = [];
		for (
		  var methods = ['load','page','track','identify', 'alias','group','ready','reset','getAnonymousId','setAnonymousId'],
		  i = 0;
		  i < methods.length;
		  i++
		) {
		  var method = methods[i];
		  snapyr[method] = (function (n) {
			return function () {
			  snapyr.push([n].concat(Array.prototype.slice.call(arguments)));
			};
		  })(method);
		}
		snapyr.load("JJAzzlsU0tdrNJEJ1voRepSDgcQL5GSy", 'https://engine.snapyr.com');
		snapyr.page();

		splinterlands.utils.loadScript("https://sdk.snapyr.com/js/1.0.0/snapyr-sdk.min.js", () => {
			console.log("Snapyr Loaded");
		});
	}

	function set_url(url) { 
		_url = url; 
		localStorage.setItem('splinterlands:ref', splinterlands.utils.getURLParameter(url, 'ref'));
	}

	async function set_referral_account(referral_account) { 
		let account_exists = await splinterlands.utils.account_exists(referral_account);
		if(account_exists) { 
			localStorage.setItem('splinterlands:ref', referral_account);
			return { success: true };
		} else {
			return { success: false, error: "Invalid Referral Account" };
		}
	}

	function get_card_details(card_detail_id) { 
		return card_detail_id ? _cards.find(c => c.id == card_detail_id) : _cards;
	}

	function api(url, data) {
		return new Promise((resolve, reject) => {
			if (data == null || data == undefined) data = {};

			// Add a dummy timestamp parameter to prevent IE from caching the requests.
			data.v = new Date().getTime();

			if (_player) {
				data.token = _player.token;
				data.username = _player.name;
			}

			var xhr = new XMLHttpRequest();
			xhr.open('GET', _config.api_url + url + '?' + splinterlands.utils.param(data));
			xhr.onload = function() {
				if (xhr.status === 200) {
					resolve(splinterlands.utils.try_parse(xhr.responseText));
				}
				else {
					console.log(`Request failed (${url}).  Returned status of ${xhr.status}`)
					reject(`Request failed (${url}).  Returned status of ${xhr.status}`);
				}
			};
			xhr.send();
		})
	}

	function ec_api(url, data) {
		return new Promise((resolve, reject) => {
			if (data == null || data == undefined) data = {};

			// Add a dummy timestamp parameter to prevent IE from caching the requests.
			data.v = new Date().getTime();

			if (_player) {
				data.token = _player.token;
				data.username = _player.name;
			}

			var xhr = new XMLHttpRequest();
			xhr.open('GET', _config.ec_api_url + url + '?' + splinterlands.utils.param(data));
			xhr.onload = function() {
				if (xhr.status === 200)
					resolve(splinterlands.utils.try_parse(xhr.responseText));
				else
					reject('Request failed.  Returned status of ' + xhr.status);
			};
			xhr.send();
		});
	}

	async function api_post(url, data) {
		if (data == null || data == undefined) data = {};

		data.v = new Date().getTime();

		if (_player) {
			data.token = _player.token;
			data.username = _player.name;
		}

		let response = await fetch(_config.api_url + url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: splinterlands.utils.param(data),
		});
		
		if(response.ok) {
			return response.json();
		} else {
			return Promise.reject(`Request failed.  Returned status of ${response.status}: ${response.statusText}`);
		}
	}

	async function log_event(event_name, data) {
		let params = {
			browser_id: _browser_id,
			session_id: _session_id,
			event_name: event_name,
			page: '',
			user_agent: window.navigator.userAgent,
			browser_language: window.navigator.language,
			site_language: localStorage.getItem('splinterlands:locale'),
			url: _url,
			ref: localStorage.getItem('splinterlands:ref')
		};

		if(data)
			params.data = JSON.stringify(data);

		return await api('/players/event', params);
	}

	async function load_settings() {
		let response = await api('/settings');

		if(_settings.version && _settings.version != response.version) {
			// Dispatch new version event
			window.dispatchEvent(new CustomEvent('splinterlands:version_change', { detail: response.version }));
		}

		if(_settings.maintenance_mode !== undefined && _settings.maintenance_mode != response.maintenance_mode) {
			// Dispatch maintenance mode event
			window.dispatchEvent(new CustomEvent('splinterlands:maintenance_mode', { detail: { maintenance_mode: response.maintenance_mode } }));
		}

		_settings = response;
	}

	function has_saved_login() {
		let username = localStorage.getItem('splinterlands:username');

		if(!username)
			return null;

		let key = localStorage.getItem('splinterlands:key');
		return { username, use_keychain: !key };
	}

	async function email_login(email, password) {
		// Make sure the email address is all lowercase
		email = email.trim().toLowerCase();

		let params = { email: encodeURIComponent(email) };
		let password_key = steem.auth.getPrivateKeys(email, password).owner;

		// Sign the login request using the private key generated from the email and password combination
		params.ts = Date.now();
		params.sig = eosjs_ecc.sign(email + params.ts, password_key);

		let response = await api('/players/login_email', params);

		if(response.error)
			return response;

		return await login(response.username, response.posting_key);
	}

	async function eos_login() {
		let params = await splinterlands.eos.scatterAuth();		
		if(params.error)
			return({ "error" : params.message });
		
		let response = await api('/players/login_eos', params);	
		if(response.error) {
			response.address = params.address; //Needed to show account name for new account popup
			return(response);
		}			
		
		return (await login(response.username, response.posting_key));			
	}

	async function eth_login() {
		let params = await splinterlands.ethereum.web3Auth();		
		if(params.error)
			return({ "error" : params.message });
		
		let response = await ec_api('/players/login_eth', params);	
		if(response.error) {
			response.address = params.address; //Needed to show account name for new account popup
			return(response);
		}			
		
		return (await login(response.username, response.posting_key));			
	}

	async function login(username, key) {
		if(!username) {
			username = localStorage.getItem('splinterlands:username');
			key = localStorage.getItem('splinterlands:key');

			if(!username)
				return { success: false, error: 'Username not specified.' };
		}

		// Format the username properly
		username = username.toLowerCase().trim();
		if(username.startsWith('@')) 
			username = username.substr(1);
		
		try {			
			// They are logging in with an email address
			if(username.includes('@'))
				return await email_login(username, key);

			// Use the keychain extension if no private key is specified for login
			_use_keychain = !key;

			if(_use_keychain && !window.hive_keychain)
				return { success: false, error: 'Missing private posting key.' };

			let params = { name: username, ref: localStorage.getItem('splinterlands:ref'), ts: Date.now() };
		
		
			if(!_use_keychain) {
				if(key.startsWith('STM'))
					return { success: false, error: 'This appears to be a public key. You must use your private posting key to log in.' };

				// Check if this is a master password, if so try to generate the private key
				if (key && !steem.auth.isWif(key))
					key = steem.auth.getPrivateKeys(username, key, ['posting']).posting;

				// Check that the key is a valid private key.
				try { steem.auth.wifToPublic(key); }
				catch (err) { return { success: false, error: `Invalid password or private posting key for account @${username}` }; }

				// Sign the login request using the provided private key
				params.ts = Date.now();
				params.sig = eosjs_ecc.sign(username + params.ts, key);
			} else {
				params.sig = await new Promise(resolve => hive_keychain.requestSignBuffer(username, username + params.ts, 'Posting', r => resolve(r.result)));

				if(!params.sig)
					return { success: false, error: 'Unable to log in with account @' + username };
			}

			// Get the encrypted access token from the server
			let response = await api('/players/login', params);
			
			if(!response || response.error)
				throw new Error(response)
				
			_player = new splinterlands.Player(response);

			localStorage.setItem('splinterlands:username', username);

			if(!_use_keychain)
				localStorage.setItem('splinterlands:key', key);

			// Start the websocket connection if one is specified
			if(_config.ws_url)
				splinterlands.socket.connect(_config.ws_url, _player.name, _player.token);

			// Load the player's card collection
			await load_collection();

			// Check if the player is currently involved in a match
			if(_player.outstanding_match && _player.outstanding_match.id) {
				// Set it as the currently active match
				let match = set_match(_player.outstanding_match);
				_player.outstanding_match = match;

				// Check if the current player has already submitted, but not revealed, their team
				if(match.team_hash && !match.team) {
					// If the opponent already submitted their team, then we can reveal ours
					if(match.opponent_team_hash)
						await splinterlands.ops.team_reveal(match.id);
					else {
						// If the opponent has not submitted their team, then queue up the team reveal operation for when they do
						match.on_opponent_submit = async () => await splinterlands.ops.team_reveal(match.id);
					}
				}

				// Emit an outstanding_match event
				window.dispatchEvent(new CustomEvent('splinterlands:outstanding_match', { detail: match }));
			}
		} catch (e) {
			console.log("There was an issue with logging in: " + ((e.error) ? e.error : e))			
			throw { error: "There was an issue with logging in: " + ((e.error) ? e.error : e) } 
		}

		log_event('log_in');
		if(splinterlands.is_mobile_app) {
			_player.set_player_property('app', `mobile_${splinterlands.mobile_OS}`);
		}

		splinterlands.utils.loadScript("https://platform.twitter.com/oct.js", () => {
			twttr.conversion.trackPid('o5rpo', { tw_sale_amount: 0, tw_order_quantity: 0 });
		});

		snapyr.identify(_player.alt_name || _player.name,
			{ 
				join_date: _player.join_date, 
				starter_pack_purchase: _player.starter_pack_purchase,
				email: _player.email				
			}
		);

		snapyr.track(
			"login",
			{
				is_mobile: true
			}
		);

		//Womplay Sign Up check
		let womplay_id = await _player.get_womplay_id();
		let new_womplay_id = splinterlands.get_init_url_search_params().get("uid");
		if(!womplay_id && new_womplay_id) {
			await splinterlands.ec_api("/womplay/sign_up", { womplay_id: new_womplay_id  });
			_player.get_player_properties(true);
		}

		return _player;
	}
	
	async function reset_password(email) {
		return await api('/players/forgot_password', { email });
	}
  
  function logout() {
    localStorage.removeItem('splinterlands:username');
    localStorage.removeItem('splinterlands:key');
    _player = null;
    _collection = null;
		splinterlands.socket.close();
	}
	
	async function send_tx_wrapper(id, display_name, data, on_success) {
		return new Promise((resolve, reject) => {
			send_tx(id, display_name, data).then(async result => {
				// If there is any type of error, just return the result object
				if(!result || !result.trx_info || !result.trx_info.success || result.error)
					reject(result);
				else {
					try { resolve(await on_success(new splinterlands.Transaction(result.trx_info))); }
					catch (err) { reject(err); }
				}
			});
		});
	}

	async function send_tx(id, display_name, data) {
		// Only use this method for battle API transactions for now
		if(!splinterlands.get_settings().api_ops.includes(id)) {
			return await send_tx_old(id, display_name, data); 
		}

		let active_auth = _player.require_active_auth && _settings.active_auth_ops.includes(id);
		id = splinterlands.utils.format_tx_id(id);

		try { data = splinterlands.utils.format_tx_data(data); }
		catch(err) {
			log_event('tx_length_exceeded', { type: id });
			return { success: false, error: err.toString() };
		}

		let data_str = JSON.stringify(data);

		let tx = { 
			operations: [['custom_json', { 
				required_auths: active_auth ? [_player.name] : [],
				required_posting_auths: active_auth ? [] : [_player.name],
				id,
				json: data_str
			}]] 
		};

		try {
			// Start waiting for the transaction to be picked up by the server immediately
			let check_tx_promise = check_tx(data.sm_id);
			let broadcast_promise = null;

			if(_player.use_proxy) {
			} else {
				broadcast_promise = server_broadcast_tx(tx, active_auth).then(response => {
					return {
						type: 'broadcast',
						method: 'battle_api',
						success: (response && response.id),
						trx_id: (response && response.id) ? response.id : null,
						error: response.error ? response.error : null
					}
				});
			}

			let result = await Promise.race([check_tx_promise, broadcast_promise]);

			// Check if the transaction was broadcast and picked up by the server before we got the result from the broadcast back
			if(result.type != 'broadcast')
				return result;

			if(result.success) {
				// Wait for the transaction to be picked up by the server
				return await check_tx_promise;
			} else {
				clear_pending_tx(data.sm_id);
				return await send_tx_old(id, display_name, data);
			}
		} catch (err) {
			console.log(err);
			return await send_tx_old(id, display_name, data);
		}
	}

	async function send_tx_old(id, display_name, data, retries) {
		if(!retries) retries = 0;

		let active_auth = _player.require_active_auth && _settings.active_auth_ops.includes(id);
		id = splinterlands.utils.format_tx_id(id);

		try { data = splinterlands.utils.format_tx_data(data); }
		catch(err) {
			log_event('tx_length_exceeded', { type: id });
			return { success: false, error: err.toString() };
		}

		let data_str = JSON.stringify(data);

		// Start waiting for the transaction to be picked up by the server immediately
		let check_tx_promise = check_tx(data.sm_id);

		let broadcast_promise = null;

		if(_player.use_proxy) {
			broadcast_promise = new Promise(resolve => {
				splinterlands.utils.post(`${_config.tx_broadcast_url}/proxy`, { player: _player.name, access_token: _player.token, id, json: data })
					.then(r => resolve({ type: 'broadcast', method: 'proxy', success: true, trx_id: r.id }))
					.catch(err => resolve({ type: 'broadcast', method: 'proxy', success: true, error: err }));
			});
		} else if(_use_keychain) {
			broadcast_promise = new Promise(resolve => hive_keychain.requestCustomJson(_player.name, id, active_auth ? 'Active' : 'Posting', data_str, display_name, response => {
				resolve({ 
					type: 'broadcast',
					method: 'keychain',
					success: response.success, 
					trx_id: response.success ? response.result.id : null,
					error: response.success ? null : ((typeof response.error == 'string') ? response.error : JSON.stringify(response.error))
				})
			}));
		} else {
			if(active_auth) {
				splinterlands.utils.sc_custom_json(id, 'Splinterlands Transaction', data, true);
				broadcast_promise = new Promise(resolve => resolve({ type: 'broadcast', success: true, method: 'steem_connect' }));
			} else {
				broadcast_promise = new Promise(resolve => steem.broadcast.customJson(localStorage.getItem('splinterlands:key'), [], [_player.name], id, data_str, (err, response) => {
					resolve({
						type: 'broadcast',
						method: 'steem_js',
						success: (response && response.id),
						trx_id: (response && response.id) ? response.id : null,
						error: err ? JSON.stringify(err) : null
					});
				}));
			}
		}

		let result = await Promise.race([check_tx_promise, broadcast_promise]);

		// Check if the transaction was broadcast and picked up by the server before we got the result from the broadcast back
		if(result.type != 'broadcast')
			return result;

		if(result.success) {
			// Wait for the transaction to be picked up by the server
			return await check_tx_promise;
		} else {
			clear_pending_tx(data.sm_id);

			if(result.error == 'user_cancel')
				return result;
			else if(result.error.indexOf('Please wait to transact') >= 0) {
				// The account is out of Resource Credits, request an SP delegation
				let delegation_result = await api('/players/delegation');

				if(delegation_result && delegation_result.success) {
					// If the delegation succeeded, retry the transaction after 3 seconds
					await splinterlands.utils.timeout(3000);
					return await send_tx(id, display_name, data, retries + 1);
				} else {
				 	log_event('delegation_request_failed', { operation: id, error: result.error });
					return "Oops, it looks like you don't have enough Resource Credits to transact on the Steem blockchain. Please contact us on Discord for help! Error: " + result.error;
				}
			} else if(retries < 2) {
				// Try switching to another RPC node
				splinterlands.utils.switch_rpc();

				// Retry the transaction after 3 seconds
				await splinterlands.utils.timeout(3000);
				return await send_tx(id, display_name, data, retries + 1);
			} else {
				log_event('custom_json_failed', { response: JSON.stringify(result) });
				return result;
			}
		}
	}

	function prepare_tx(tx) {
		return Object.assign({
			ref_block_num: splinterlands.get_settings().chain_props.ref_block_num & 0xFFFF,
			ref_block_prefix: splinterlands.get_settings().chain_props.ref_block_prefix,
			expiration: new Date(
				new Date(splinterlands.get_settings().chain_props.time + 'Z').getTime() +
				600 * 1000
			),
		}, tx);
	}

	async function sign_tx(tx, use_active) {
		return new Promise(async (resolve, reject) => {
			try {
				if(!tx.expiration)
					tx = prepare_tx(tx);

				let signed_tx = null;

				if(_use_keychain) {
					let response = await new Promise(resolve => hive_keychain.requestSignTx(_player.name, tx, use_active ? 'Active' : 'Posting', resolve));
					
					if(response && response.success)
						signed_tx = response.result;
					else
						return reject(response);
				} else {
					let key = localStorage.getItem('splinterlands:key');

					if(!key)
						return reject({ error: 'Key not found.' });

					signed_tx = steem.auth.signTransaction(tx, [key]);
				}

				signed_tx.expiration = signed_tx.expiration.split('.')[0];
				resolve(signed_tx);
			} catch(err) { reject(err); }
		});
	}

	async function server_broadcast_tx(tx, use_active) {
		return new Promise(async (resolve, reject) => {
			try {
				let signed_tx = await sign_tx(tx, use_active);
				
				if(!signed_tx)
					return;

				let op_name = tx.operations[0][1].id.replace(splinterlands.get_settings().test_mode ? `${splinterlands.get_settings().prefix}sm_` : 'sm_', '');

				if(splinterlands.get_settings().api_ops.includes(op_name)) {
					api_post(`/battle/battle_tx`, { signed_tx: JSON.stringify(signed_tx) }).then(resolve).catch(reject);
					return;
				}

				// TODO: Get broadcast API stuff working
				//let bcast_url = Config.tx_broadcast_urls[Math.floor(Math.random() * Config.tx_broadcast_urls.length)];
				//api_post(`${bcast_url}/send`, { signed_tx: JSON.stringify(signed_tx) }, resolve).fail(reject);
				resolve({ error: `Unsupported server broadcast operation.` });
			} catch (err) { reject(err); }
		});
	}

	async function browser_payment(to, amount, currency, memo) {
		let token = splinterlands.utils.get_token(currency);

		switch(token.type) {
			case 'hive':
				if(_use_keychain) {
					var result = await new Promise(resolve => hive_keychain.requestTransfer(_player.name, to, parseFloat(amount).toFixed(3), memo, currency, response => resolve(response)));
					return !result.success ? { success: false, error: result.error } : result;
				} else {
					let sc_url = `https://hivesigner.com/sign/transfer?to=${to}&amount=${parseFloat(amount).toFixed(3)}%20${currency}&memo=${encodeURIComponent(memo)}`;
					splinterlands.utils.popup_center(sc_url, `${currency} Payment`, 500, 560);
				}
				break;
			case 'steem':
				if(window.steem_keychain) {
					var result = await new Promise(resolve => steem_keychain.requestTransfer(_player.name, to, parseFloat(amount).toFixed(3), memo, currency, response => resolve(response)));
					return !result.success ? { success: false, error: result.error } : result;
				} else {
					let sc_url = `https://steemconnect.com/sign/transfer?to=${to}&amount=${parseFloat(amount).toFixed(3)}%20${currency}&memo=${encodeURIComponent(memo)}`;
					splinterlands.utils.popup_center(sc_url, `${currency} Payment`, 500, 560);
				}
				break;
			case 'hive_engine':
				var result = await splinterlands.utils.hive_engine_transfer(to, currency, amount, memo);
				return !result.success ? { success: false, error: result.error } : result;
			case 'internal':
				return await splinterlands.ops.token_transfer(to, amount, splinterlands.utils.tryParse(memo));
			case 'tron':
				return await window.tronWeb.trx.sendTransaction(to, tronWeb.toSun(parseFloat(amount).toFixed(6)));
			case 'eos':
				return await splinterlands.eos.scatterPay(to, amount, memo);
			case 'eth':
				return await splinterlands.ethereum.web3Pay(to, amount);				
			case 'erc20':			
				return await splinterlands.ethereum.erc20Payment(currency.toUpperCase(), amount * 1000, memo);
		}
	}

	async function external_deposit(wallet_type, to, amount, currency, memo) {
		switch(wallet_type) {
			case 'hive_engine':
				var result = await splinterlands.utils.hive_engine_transfer(to, currency, amount, memo);
				return !result.success ? { success: false, error: result.error } : result;
			case 'tron':
				if(currency != 'DEC')
					return { success: false, error: 'Invalid currency specified.' };

				let token = splinterlands.utils.get_token('DEC-TRON');
				return await splinterlands.tron.sendToken(to, amount, token.token_id);
			case 'bsc':
				if(currency != 'DEC')
					return { success: false, error: 'Invalid currency specified.' };

				return await splinterlands.bsc.bscDeposit(amount, splinterlands.get_player().name);
		}
	}

	function check_tx(sm_id, timeout) {
		return new Promise(resolve => {
			_transactions[sm_id] = { resolve: resolve };
			
			_transactions[sm_id].timeout = setTimeout(() => {
				if(_transactions[sm_id] && _transactions[sm_id].status != 'complete')
					resolve({ success: false, error: 'Your transaction could not be found. This may be an issue with the game server. Please try refreshing the site to see if the transaction went through.' });

				delete _transactions[sm_id];
			}, (timeout || 30) * 1000);
		});
	}

	function clear_pending_tx(sm_id) {
		let tx = _transactions[sm_id];

		if(tx) {
			clearTimeout(tx.timeout);
			delete _transactions[sm_id];
		}
	}

	async function load_collection(player) {
		if(player && _player && player !== _player.name) { //If getting collection of another player
			console.log("Updating Collection: ", player);
			_collection = (await api(`/cards/collection/${player}`)).cards.map(c => new splinterlands.Card(c));
			_collection_grouped = null;		
		} else {
			if(_player.has_collection_power_changed) {
				console.log("Updating Collection current player");
				if(!player && _player)
					player = _player.name;
	
				_collection = (await api(`/cards/collection/${player}`)).cards.map(c => new splinterlands.Card(c));
				_collection_grouped = null;
	
				// If this is the current player's collection, add any "starter" cards				
				get_card_details().filter(d => d.is_starter_card && !_collection.find(c => c.card_detail_id == d.id))
					.forEach(c => _collection.push(splinterlands.utils.get_starter_card(c.id, c.starter_edition)));
					
				_player.has_collection_power_changed = false;
			}
		}

		//Filter out Gladiator cards for now.
		_collection = _collection.filter((c => c.edition != 6))

		return _collection;
	}

	async function load_market() {
		_market = await api('/market/for_sale_grouped');
		return _market;
	}

	async function get_potions() {
		if(_potions.length == 0)
			_potions = splinterlands.get_settings().potions.map(p => new splinterlands.Potion(p));

		return _potions;
	}

	let _lore = {};
	async function load_card_lore(card_detail_id) {
		if(!_lore[card_detail_id])
			_lore[card_detail_id] = (await api('/cards/lore', { card_detail_id })).text;

		return _lore[card_detail_id];
	}

	let _collection_grouped = null;
	function group_collection(collection, id_only) {
		if(!collection && _collection_grouped && !id_only)
			return _collection_grouped;

		let save = !collection && !id_only;
			
		if(!collection)
			collection = _collection;

		let grouped = [];

		// Group the cards in the collection by card_detail_id, edition, and gold foil
		_cards.forEach(details => {
			if(id_only) {
				grouped.push(new splinterlands.CardDetails(Object.assign({ card_detail_id: details.id, owned: collection.filter(o => o.card_detail_id == details.id) }, details)));	 
			} else {
				details.available_editions.forEach(edition => {
          let reg_cards = collection.filter(o => o.card_detail_id == details.id && o.gold == false && o.edition == parseInt(edition));

          if(reg_cards.length > 0) {
            grouped.push(new splinterlands.Card(Object.assign({ owned: reg_cards }, reg_cards[0])));
          } else {
            grouped.push(new splinterlands.Card({
              gold: false,
              card_detail_id: details.id,
              edition: parseInt(edition),
              owned: reg_cards
            }));
          }

          let gold_cards = collection.filter(o => o.card_detail_id == details.id && o.gold == true && o.edition == parseInt(edition));

          if(gold_cards.length > 0) {
            grouped.push(new splinterlands.Card(Object.assign({ owned: gold_cards }, gold_cards[0])));
          } else {
            grouped.push(new splinterlands.Card({
              gold: true,
              card_detail_id: details.id,
              edition: parseInt(edition),
              owned: gold_cards
            }));
          }
				});
			}
		});

		if(save)
			_collection_grouped = grouped;

		return grouped;
	}

	function group_collection_by_card(card_detail_id) {
		return group_collection().filter(c => c.card_detail_id == card_detail_id);
	}

	function get_battle_summoners(match) {
		return group_collection(_collection, true).filter(d => d.type == 'Summoner' && d.owned.length > 0).map(d => {
			// Check if the splinter is inactive for this battle
			if(match.inactive.includes(d.color))
				return null;

			// Check if it's an allowed card
			if(['no_legendaries', 'no_legendary_summoners'].includes(match.allowed_cards) && d.rarity == 4)
				return null;

			// Check if it is allowed but the current ruleset
			if(match.ruleset.includes('Little League') && d.stats.mana > 4)
				return null;

			let card = d.owned.find(o => 
				(match.allowed_cards != 'gold_only' || o.gold) && 
				(match.allowed_cards != 'alpha_only' || o.edition == 0) &&
				(match.match_type == 'Ranked' ? o.playable_ranked : o.playable) &&
				(!o.delegated_to || o.delegated_to == _player.name));

			// Add "starter" card
			if(!card && !['gold_only', 'alpha_only'].includes(match.allowed_cards) && d.is_starter_card)
				card = splinterlands.utils.get_starter_card(d.id, d.starter_edition);

			if(card) {
				card = new splinterlands.Card(Object.assign({}, card));
				card.level = splinterlands.utils.get_summoner_level(match.rating_level, card);
			}

			return card;
		}).filter(c => c).sort((a, b) => a.stats.mana - b.stats.mana);
	}

	function get_battle_monsters(match, summoner_card, ally_color) {
		let summoner_details = get_card_details(summoner_card.card_detail_id);

		return group_collection(_collection, true)
			.filter(d => d.type == 'Monster' && d.owned.length > 0 && (d.color == summoner_details.color || d.color == 'Gray' || (summoner_details.color == 'Gold' && d.color == ally_color)))
			.map(d => {
				// Check if it's an allowed card
				if((match.ruleset.includes('Lost Legendaries') || match.allowed_cards == 'no_legendaries') && d.rarity == 4)
					return;

				if(match.ruleset.includes('Rise of the Commons') && d.rarity > 2)
					return;

				if(match.ruleset.includes('Taking Sides') && d.color == 'Gray')
					return;

				if(match.ruleset.includes('Little League') && d.stats.mana[0] > 4)
					return;

				if(match.ruleset.includes('Even Stevens') && d.stats.mana[0] % 2 == 1)
					return;

				if(match.ruleset.includes('Odd Ones Out') && d.stats.mana[0] % 2 == 0)
					return;

				let card = d.owned.find(o => 
					(match.allowed_cards != 'gold_only' || o.gold) && 
					(match.allowed_cards != 'alpha_only' || o.edition == 0) &&
					(match.match_type == 'Ranked' ? o.playable_ranked : o.playable) &&
					(!o.delegated_to || o.delegated_to == _player.name));

				// Add "starter" card
				if(!card && !['gold_only', 'alpha_only'].includes(match.allowed_cards) && d.is_starter_card)
					card = splinterlands.utils.get_starter_card(d.id, d.starter_edition);

				if(card) {
					card = new splinterlands.Card(Object.assign({}, card));
					card.level = splinterlands.utils.get_monster_level(match.rating_level, summoner_card, card);

					if(match.ruleset.includes('Up Close & Personal') && d.stats.attack[card.level - 1] == 0)
						return;

					if(match.ruleset.includes('Keep Your Distance') && d.stats.attack[card.level - 1] > 0)
						return;

					if(match.ruleset.includes('Broken Arrows') && d.stats.ranged[card.level - 1] > 0)
						return;

					if(match.ruleset.includes('Lost Magic') && d.stats.magic[card.level - 1] > 0)
						return;
				}

				return card;
			}).filter(c => c).sort((a, b) => a.stats.mana - b.stats.mana);
	}

	async function create_blockchain_account(username) {
		username = username.toLowerCase();

		try {
			let result = await api('/players/create_blockchain_account', { name: username, is_test: splinterlands.get_settings().test_acct_creation });

			if(result.error)
				return result;

			await send_tx_wrapper('upgrade_account', 'Upgrade Account', { account_name: username }, tx => tx);
			return await login(result.username, result.posting_key);
		} catch (err) { return err; }
	}

	async function create_account_email(email, password, subscribe, captcha_token) {
		// Make sure the email address is all lowercase
		email = email.trim().toLowerCase();

		// Generate a key pair based on the email and password
		let password_pub_key = steem.auth.getPrivateKeys(email, password).ownerPubkey;

		let params = { 
			purchase_id: 'new-' + splinterlands.utils.randomStr(6),	// We need to set a purchase ID even though not making a purchase for backwards compatibility
			email: encodeURIComponent(email), 
			password_pub_key: password_pub_key,
			subscribe: subscribe,
			is_test: splinterlands.get_settings().test_acct_creation,
			ref: localStorage.getItem('splinterlands:ref'),			
			ref_url: localStorage.getItem('splinterlands:url'),
			captcha_token: captcha_token
		};

		let response = await api('/players/create_email', params);

		if(response && !response.error) {
			let login_response = await email_login(email, password); // Must login first for splinterlands.get_player() to work for tracking
			
			log_event('sign_up');

			snapyr.track(
				"sign_up",
				{
					playerName: splinterlands.get_player().alt_name || splinterlands.get_player().name,
					type: "email"
				}
			);

			splinterlands.utils.loadScript("https://platform.twitter.com/oct.js", () => {
				twttr.conversion.trackPid('o4d37', { tw_sale_amount: 0, tw_order_quantity: 0 });
			});

			return login_response;
		}

		return response;
	}

	async function create_account_eos(email, subscribe, captcha_token) {
		let account = await splinterlands.eos.getIdentity();
		email = email.trim().toLowerCase();

		let params = { 
			login_type: 'eos',
			purchase_id: 'new-' + splinterlands.utils.randomStr(6),	// We need to set a purchase ID even though not making a purchase for backwards compatibility
			email: email,
			address: account.name, 
			password_pub_key: account.publicKey,
			subscribe: subscribe,
			is_test: splinterlands.get_settings().test_acct_creation,
			ref: localStorage.getItem('splinterlands:ref'),
			ref_url: localStorage.getItem('splinterlands:url'),
			browser_id: _browser_id,
			captcha_token: captcha_token
		};

		let response = await api('/players/create_email', params);

		if(response && !response.error) {
			let login_response = await eos_login();

			log_event('sign_up');

			snapyr.track(
				"sign_up",
				{
					playerName: splinterlands.get_player().alt_name || splinterlands.get_player().name,
					type: "eos"
				}
			);

			splinterlands.utils.loadScript("https://platform.twitter.com/oct.js", () => {
				twttr.conversion.trackPid('o4d37', { tw_sale_amount: 0, tw_order_quantity: 0 });
			});

			return login_response;
		}

		return response;
	}	

	async function create_account_eth(email, subscribe, captcha_token) {
		let account = await splinterlands.ethereum.getIdentity();
		email = email.trim().toLowerCase();

		let params = { 
			login_type: 'ethereum',
			purchase_id: 'new-' + splinterlands.utils.randomStr(6),	// We need to set a purchase ID even though not making a purchase for backwards compatibility
			email: email,
			address: account.publicKey, 
			password_pub_key: account.publicKey,
			subscribe: subscribe,
			is_test: splinterlands.get_settings().test_acct_creation,
			ref: localStorage.getItem('splinterlands:ref'),
			ref_url: localStorage.getItem('splinterlands:url'),
			browser_id: _browser_id,
			captcha_token: captcha_token
		};

		let response = await api('/players/create_eth', params);

		if(response && !response.error) {
			let login_response = eth_login();

			log_event('sign_up');

			snapyr.track(
				"sign_up",
				{
					playerName: splinterlands.get_player().alt_name || splinterlands.get_player().name,
					type: "eth"
				}
			);

			splinterlands.utils.loadScript("https://platform.twitter.com/oct.js", () => {
				twttr.conversion.trackPid('o4d37', { tw_sale_amount: 0, tw_order_quantity: 0 });
			});

			return login_response;
		}

		return response;
	}	

	async function redeem_promo_code(code, purchase_id) {
		let response = await api('/purchases/start_code', { code, purchase_id });

		if(!response || response.error)
			return response;

		// Wait for completion of the purchase
		return await check_tx(purchase_id);
	}

	async function check_promo_code(code) {
		return await api('/purchases/check_code', { code });
	}

	async function get_available_packs(edition) {
		try {
			let packs = (await api('/purchases/stats')).packs;
			return packs.find(p => p.edition == edition).available;
		} catch(err) { return 0; }
	}

	function set_match(match_data) {
		if(!match_data) {
			_match = null;
			return;
		}

		_match = _match ? _match.update(match_data) : new splinterlands.Match(match_data);
		return _match;
	}
	
	function wait_for_match() {
		return new Promise((resolve, reject) => {
			if(!_match) {
				reject({ error: 'Player is not currently looking for a match.', code: 'not_looking_for_match' });
				return;
			}

			// Player has already been matched with an opponent
			if(_match.status == 1) {
				resolve(_match);
				return;
			}

			_match.on_match = resolve;
			_match.on_timeout = reject;
		});
	}

	function wait_for_result() {
		return new Promise((resolve, reject) => {
			if(!_match) {
				reject({ error: 'Player is not currently in a match.', code: 'not_in_match' });
				return;
			}

			// The battle is already resolved
			if(_match.status == 2) {
				resolve(_match);
				return;
			}

			_match.on_result = resolve;
			_match.on_timeout = reject;
		});
	}

	async function battle_history(player, limit) {
		let response = await api('/battle/history2', { player, limit });
		
		if(response && response.battles)
			return response.battles.map(r => new splinterlands.Battle(r));

		return response;
	}

	async function get_leaderboard(season, leaderboard_id, page) {
		let leaderboard = await api('/players/leaderboard_with_player', { season, leaderboard: leaderboard_id, page });

		if(leaderboard.leaderboard)
			leaderboard.leaderboard = leaderboard.leaderboard.map(p => new splinterlands.Player(p));

		leaderboard.player = leaderboard.player ? new splinterlands.Player(leaderboard.player) : _player;
		return leaderboard;
	}

	async function get_global_chat() {
		let history = await api('/players/chat_history');
		history.forEach(h => h.player = new splinterlands.Player(h.player));
		return history;
	}

	async function get_news() {
		const res = await fetch(`${splinterlands.get_settings().asset_url}website/mobile_news/sps_airdrop.html`);

		let news = await res.text();
		
        return { has_news: true, news_html: news }
	}

	return { 
		init, api, ec_api, api_post, login, logout, send_tx, send_tx_wrapper, load_collection, group_collection, get_battle_summoners, get_battle_monsters, get_card_details, 
		log_event, load_market, browser_payment, has_saved_login, create_account_email, email_login, check_promo_code, redeem_promo_code, reset_password, load_card_lore, group_collection_by_card, get_available_packs, get_potions, wait_for_match, wait_for_result, battle_history,
		get_leaderboard, get_global_chat, set_url, external_deposit, create_blockchain_account,
		get_config: () => _config,
		get_settings: () => _settings,
		get_player: () => _player,
		get_market: () => _market,
		get_collection: () => _collection,
		get_transaction: (sm_id) => _transactions[sm_id],
		use_keychain: () => _use_keychain,
		get_match: () => _match,
		set_match,
		eos_login,
		create_account_eos,
		get_init_url_search_params: () => _init_url_search_params,
		eth_login,
		create_account_eth,
		get_server_time_offset: () => _server_time_offset,
		get_news,
		set_referral_account
	};
})();

window.startWrappedApp = function(is_android, version) {
	splinterlands.is_android = (is_android == null || !!is_android);
	splinterlands.is_mobile_app = true; 
	splinterlands.mobile_OS_ver = version;

	if(is_android == null || is_android) {
		splinterlands.mobile_OS = "android";
	}
	else {
		splinterlands.mobile_OS = "iOS";
	}
	
	window.showLoadingAnimation = function(showLoader, text) {
		text = (text) ? text.replaceAll("<br>", "\n") : "";
		window.dispatchEvent(new CustomEvent('splinterlands:show_loading_animation', { detail: { showLoader, text } }));
	}

	return true;
}