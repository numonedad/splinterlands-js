splinterlands.Battle = class {
	constructor(data) {
		Object.keys(data).forEach(k => this[k] = data[k]);

		if(typeof this.details == 'string')
			this.details = splinterlands.utils.try_parse(this.details);

		if(typeof this.settings == 'string')
			this.settings = splinterlands.utils.try_parse(this.settings);

		if(this.details.team1) {
			this.details.team1.summoner = new splinterlands.BattleCard(Object.assign(this.details.team1.summoner, { team_num: 1 }));
			this.details.team1.monsters = this.details.team1.monsters ? 
				this.details.team1.monsters.map(m => new splinterlands.BattleCard(Object.assign(m, { team_num: 1 }))) : [];
		}

		if(this.details.team2) {
			this.details.team2.summoner = new splinterlands.BattleCard(Object.assign(this.details.team2.summoner, { team_num: 2 }));
			this.details.team2.monsters = this.details.team2.monsters ? 
				this.details.team2.monsters.map(m => new splinterlands.BattleCard(Object.assign(m, { team_num: 1 }))) : [];
		}

		this.inactive = this.inactive ? this.inactive.split(',') : "";
		this.ruleset = this.ruleset ? this.ruleset.split('|') : "";
		this.rating_level = this.settings ? this.settings.rating_level : null;
		this.allowed_cards = this.settings ? this.settings.allowed_cards : null;

		if(data.player_1_data)
			this.player1 = new splinterlands.Player(data.player_1_data);

		if(data.player_2_data)
			this.player2 = new splinterlands.Player(data.player_2_data);
	}
	
	get ruleset_images() {
		return this.ruleset ? this.ruleset.map(r => splinterlands.utils.asset_url(`website/icons/rulesets/new/img_combat-rule_${r.toLowerCase().replace(/[^a-zA-Z]+/g, '-')}_150.png`)) : "";
	}

	static async load(id) { return new splinterlands.Battle(await splinterlands.api('/battle/result', { id })); }

	static async get_tutorial_battle(player_name) {
		const res = await fetch(`${splinterlands.get_settings().asset_url}website/battle/tutorial/tutorial_battle.json`);

		let tutorialBattleData = await res.text();
		tutorialBattleData = JSON.parse(tutorialBattleData.replace(/\%\{PLAYER\}/g, player_name));
		tutorialBattleData.details = JSON.parse(tutorialBattleData.details);
		tutorialBattleData.settings = JSON.parse(tutorialBattleData.settings);		

        return new splinterlands.Battle(tutorialBattleData);
	}
}