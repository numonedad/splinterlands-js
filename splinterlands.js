var splinterlands = (function() {
	let _config = {};
	let _player = null;
	let _settings = {};
	let _cards = [];
	let _market = [];
	let _use_keychain = false;
	let _transactions = {};
	let _collection = [];
	let _browser_id = null;
	let _session_id = null;

	async function init(config) { 
		_config = config;

		// Load the browser id and create a new session id
		_browser_id = localStorage.getItem('splinterlands:browser_id');
		_session_id = 'sid_' + splinterlands.utils.randomStr(20);

		// Create a new browser id if one is not already set
		if(!_browser_id) {
			_browser_id = 'bid_' + splinterlands.utils.randomStr(20);
			localStorage.setItem('splinterlands:browser_id', _browser_id);
		}

		// Load the game settings
		await load_settings();
		setInterval(load_settings, 60 * 1000);

		// Load the card details
		_cards = await api('/cards/get_details');

		// Load market data
		await load_market();
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

			jQuery.getJSON(_config.api_url + url, data, r => resolve(r));
		});
	}

	async function log_event(event_name, data) {
		return await api('/players/event', {
			browser_id: _browser_id,
			session_id: _session_id,
			event_name: event_name,
			page: '',
			user_agent: window.navigator.userAgent,
			browser_language: window.navigator.language,
			site_language: localStorage.getItem('splinterlands:locale'),
			data: JSON.stringify(data)
		});
	}

	async function load_settings() {
		let response = await api('/settings');

		if(_settings.version && _settings.version != response.version) {
			// Dispatch new version event
			window.dispatchEvent(new CustomEvent('splinterlands:version_change', { detail: response.version }));
		}

		_settings = response;
	}

	async function load_balances() {
		_player.balances = await api('/players/balances');
		return _player.balances;
	}

	async function get_balance(token, refresh) {
		if(!_player.balances || refresh)
			await load_balances();

		let balance = _player.balances.find(b => b.token == token);
		return balance ? parseFloat(balance.balance) : 0;
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

		// Use the keychain extension if no private key is specified for login
		_use_keychain = !key;

		if(_use_keychain && !window.steem_keychain)
			return { success: false, error: 'Missing private posting key.' };

		if(!_use_keychain) {
			if(key.startsWith('STM'))
				return { success: false, error: 'This appears to be a public key. You must use your private posting key to log in.' };

			// Check if this is a master password, if so try to generate the private key
			if (key && !steem.auth.isWif(key))
				key = steem.auth.getPrivateKeys(username, key, ['posting']).posting;

			// Check that the key is a valid private key.
			try { steem.auth.wifToPublic(key); }
			catch (err) { return { success: false, error: `Invalid password or private posting key for account @${username}` }; }
		}

		// Get the encrypted access token from the server
		let response = await api('/players/login', { name: username, ref: localStorage.getItem('splinterlands:ref') });

		if(!response || response.error)
			return { success: false, error: 'An unknown error occurred trying to log in.' };

		let token = null;

		if(_use_keychain) {
			// Request that the keychain extension decrypt the token
			let keychain_response = await new Promise(resolve => steem_keychain.requestVerifyKey(username, response.token, 'Posting', r => resolve(r)));

			if(!keychain_response || !keychain_response.success)
				return { success: false, error: `The login attempt for account @${username} was unsuccessful.` };

			token = keychain_response.result.startsWith('#') ? keychain_response.result.substr(1) : keychain_response.result;
		} else {
			// Try to decrypt the token using the supplied private key
			try { token = window.decodeMemo(key, response.token).substr(1); } 
			catch (err) { return { success: false, error: 'Invalid password or private posting key for account @' + username, }; }
		}

		_player = response;
		_player.token = token;

		localStorage.setItem('splinterlands:username', username);

		if(!_use_keychain)
			localStorage.setItem('splinterlands:key', key);

		// Start the websocket connection
		splinterlands.socket.connect(_config.ws_url, _player.name, _player.token);

		// Load the player's card collection
		await load_collection();

		// Load the player's token balances
		await load_balances();

		return _player;
  }
  
  function logout() {
    localStorage.removeItem('splinterlands:username');
    localStorage.removeItem('splinterlands:key');
    _player = null;
    _collection = null;
		splinterlands.socket.close();
  }

	async function send_tx(id, display_name, data, retries) {
		if(!retries) retries = 0;

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

		if(_use_keychain) {
			broadcast_promise = new Promise(resolve => steem_keychain.requestCustomJson(_player.name, id, 'Posting', data_str, display_name, response => {
				resolve({ 
					type: 'broadcast',
					success: response.success, 
					trx_id: response.success ? response.result.id : null,
					error: response.success ? null : ((typeof response.error == 'string') ? response.error : JSON.stringify(response.error))
				})
			}));
		} else {
			broadcast_promise = new Promise(resolve => steem.broadcast.customJson(localStorage.getItem('splinterlands:key'), [], [_player.name], id, data_str, (err, response) => {
				resolve({
					type: 'broadcast',
					success: (response && response.id),
					trx_id: (response && response.id) ? response.id : null,
					error: err ? JSON.stringify(err) : null
				});
			}));
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
				// Retry the transaction after 3 seconds
				await splinterlands.utils.timeout(3000);
				return await send_tx(id, display_name, data, retries + 1);
			} else {
				log_event('custom_json_failed', { response: JSON.stringify(result) });
				return result;
			}
		}
	}

	async function send_payment(to, amount, currency, id, data) {
		id = splinterlands.utils.format_tx_id(id);

		try { data = splinterlands.utils.format_tx_data(data); }
		catch(err) {
			log_event('tx_length_exceeded', { type: id });
			return { success: false, error: err.toString() };
		}

		let token = splinterlands.utils.get_token(currency);
		let memo = JSON.stringify([id, data]);

		switch(token.type) {
			case 'steem':
				if(_use_keychain) {
					var result = await new Promise(resolve => steem_keychain.requestTransfer(_player.name, to, parseFloat(amount).toFixed(3), memo, currency, response => resolve(response)));

					if(!result.success)
						return { success: false, error: result.error };
				} else {
					let sc_url = `https://v2.steemconnect.com/sign/transfer?to=${to}&amount=${parseFloat(amount).toFixed(3)}%20${currency}&memo=${encodeURIComponent(memo)}`;
					splinterlands.utils.popup_center(sc_url, `${currency} Payment`, 500, 560);
				}
				break;
			case 'steem_engine':
				var result = await splinterlands.utils.steem_engine_transfer(to, currency, amount, memo);

				if(!result.success)
						return { success: false, error: result.error };
				break;
			case 'tron':
				break;
			case 'internal':
				return await splinterlands.ops.token_transfer(to, amount, data);
		}

		// Start waiting for the transaction to be picked up by the server
		return await check_tx(data.sm_id, 120 * 1000);
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
		if(!player && _player)
			player = _player.name;

		_collection = (await api(`/cards/collection/${player}`)).cards.map(c => new splinterlands.Card(c));
		return _collection;
	}

	async function load_market() {
		_market = await api('/market/for_sale_grouped');
		return _market;
	}

	function group_collection(collection, id_only) {
		if(!collection)
			collection = _collection;

		let grouped = [];

		// Group the cards in the collection by card_detail_id, edition, and gold foil
		_cards.forEach(details => {
			if(id_only) {
				grouped.push(Object.assign({ card_detail_id: details.id, cards: collection.filter(o => o.card_detail_id == details.id) }, details));	 
			} else {
				details.editions.split(',').forEach(edition => {
          let reg_cards = collection.filter(o => o.card_detail_id == details.id && o.gold == false && o.edition == parseInt(edition));

          if(reg_cards.length > 0) {
            grouped.push(new splinterlands.Card(Object.assign({ cards: reg_cards }, reg_cards[0])));
          } else {
            grouped.push(new splinterlands.Card({
              gold: false,
              card_detail_id: details.id,
              edition: parseInt(edition),
              cards: reg_cards
            }));
          }

          let gold_cards = collection.filter(o => o.card_detail_id == details.id && o.gold == true && o.edition == parseInt(edition));

          if(gold_cards.length > 0) {
            grouped.push(new splinterlands.Card(Object.assign({ cards: gold_cards }, gold_cards[0])));
          } else {
            grouped.push(new splinterlands.Card({
              gold: true,
              card_detail_id: details.id,
              edition: parseInt(edition),
              cards: gold_cards
            }));
          }
				});
			}
		});

		return grouped;
	}

	function get_battle_summoners(inactive_splinters, allowed_cards, ruleset, match_type, rating_level) {
		return group_collection(_collection, true).filter(d => d.type == 'Summoner' && d.cards.length > 0).map(d => {
			// Check if the splinter is inactive for this battle
			if(inactive_splinters.includes(d.color))
				return null;

			// Check if it's an allowed card
			if(['no_legendaries', 'no_legendary_summoners'].includes(allowed_cards) && d.rarity == 4)
				return null;

			// Check if it is allowed but the current ruleset
			if(ruleset == 'Little League' && d.stats.mana > 4)
				return null;

			let card = d.cards.find(o => 
				(allowed_cards != 'gold_only' || o.gold) && 
				(allowed_cards != 'alpha_only' || o.edition == 0) &&
				(match_type != 'Ranked' || splinterlands.utils.is_playable(o)) && 
				(!o.delegated_to || o.delegated_to == _player.name));

			if(card) {
				card = Object.assign({}, card);
				card.level = splinterlands.utils.get_summoner_level(rating_level, card);
			}

			return card;
		}).filter(c => c);
	}

	function get_battle_monsters(allowed_cards, ruleset, match_type, rating_level, summoner_card, ally_color) {
		let summoner_details = get_card_details(summoner_card.card_detail_id);

		return group_collection(_collection, true)
			.filter(d => d.type == 'Monster' && d.cards.length > 0 && (d.color == summoner_details.color || d.color == 'Gray' || (summoner_details.color == 'Gold' && d.color == ally_color)))
			.map(d => {
				// Check if it's an allowed card
				if((ruleset == 'Lost Legendaries' || allowed_cards == 'no_legendaries') && d.rarity == 4)
					return;

				if(ruleset == 'Rise of the Commons' && d.rarity > 2)
					return;

				if(ruleset == 'Taking Sides' && d.color == 'Gray')
					return;

				if(ruleset == 'Little League' && d.stats.mana[0] > 4)
					return;

				let card = d.cards.find(o => 
					(allowed_cards != 'gold_only' || o.gold) && 
					(allowed_cards != 'alpha_only' || o.edition == 0) &&
					(match_type != 'Ranked' || splinterlands.utils.is_playable(o)) && 
					(!o.delegated_to || o.delegated_to == _player.name));

				if(card) {
					card.capped_level = splinterlands.utils.get_monster_level(rating_level, summoner_card, card);

					if(ruleset == 'Up Close & Personal' && d.stats.attack[card.capped_level - 1] == 0)
						return;

					if(ruleset == 'Keep Your Distance' && d.stats.attack[card.capped_level - 1] > 0)
						return;

					if(ruleset == 'Broken Arrows' && d.stats.ranged[card.capped_level - 1] > 0)
						return;
				}

				return card;
			}).filter(c => c);
	}

	return { 
		init, api, login, logout, send_tx, load_collection, group_collection, get_battle_summoners, get_battle_monsters, get_card_details, 
		get_balance, log_event, load_balances, load_market, send_payment,
		get_settings: () => _settings,
		get_player: () => _player,
		get_market: () => _market,
		get_collection: () => _collection,
		get_transaction: (sm_id) => _transactions[sm_id],
		use_keychain: () => _use_keychain
	};
})();