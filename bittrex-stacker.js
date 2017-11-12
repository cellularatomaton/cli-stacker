var fs = require('fs');
console.log = function(s) {
	fs.appendFile('StackerBot.log', s + '\n', function (err) {

	});
};

console.error = function(s) {
	fs.appendFile('StackerBot.err', s + '\n', function (err) {

	});
};

var bittrex = require('./node.bittrex.api.js'),
	repl = require('repl'),
	_ = require('lodash');
	
var apiKey = "YOUR_API_KEY_GOES_HERE";
var apiSecret = "YOUR_API_SECRET_GOES_HERE";

var args = process.argv
.map(function(s){
	var a = s.split("=");
	if(a.length === 1){
		return {key: a[0], val: null};
	}else{
		return {key: a[0], val: a[1]};
	}
})
.reduce(function(map, arg, index, array){
	map[arg.key] = arg.val;
	return map;
}, {});

bittrex.options({
    'apikey' : apiKey,
    'apisecret' : apiSecret, 
    'stream' : true,
    'verbose' : true,
    'cleartext' : false,
	'baseUrl': 'https://bittrex.com/api/v1.1'
});

var log = function(s){
	process.stdout.write(s + '\n');
};

var getBook = function(params, callback){
	var url = 'https://bittrex.com/api/v1.1/public/getorderbook?market=' + params.symbol + '&type=both&depth=50';
	bittrex.sendCustomRequest( url, function( data ) {
		//console.log(data.message);
		callback(data.result);
	});
};

var getMarket = function(params, callback){
	var url = 'https://bittrex.com/api/v1.1/public/getmarkets';
	bittrex.sendCustomRequest( url, function( data ) {
		//console.log(data.message);
		callback(data.result.filter(function(market){return market.MarketName === params.symbol;})[0]);
	});
};

var getOpenOrders = function(params, callback){
	var url = 'https://bittrex.com/api/v1.1/market/getopenorders?apiKey=' + apiKey + '&market=' + params.symbol;
	bittrex.sendCustomRequest( url, function( data ) {
		//console.log(data.message);
		callback(data.result);
	}, true);
};

var cancelOrder = function(orderId, callback){
	var url = 'https://bittrex.com/api/v1.1/market/cancel?apiKey=' + apiKey + '&uuid=' + orderId;
	bittrex.sendCustomRequest( url, function( data ) {
		console.log(data.message);
		callback(data);
	}, true);
};

var adjustBidMap = function(params, order){
	var px = order.Limit.toFixed(params.tickPrecision);
	if(bidMap[px]){
		bidMap[px] = bidMap[px].filter(function(a){
			return a.orderId !== order.OrderUuid;
		});
		if(!bidMap[px].length){
			delete bidMap[px];
		}
	}
};

var adjustAskMap = function(params, order){
	var px = order.Limit.toFixed(params.tickPrecision);
	if(askMap[px]){
		askMap[px] = askMap[px].filter(function(a){
			return a.orderId !== order.OrderUuid;
		});
		if(!askMap[px].length){
			delete askMap[px];
		}
	}
};

var cancelOpenOrders = function(params, callback){
	getOpenOrders(params, function(orders){
		while(0 < orders.length){
			var order = orders.pop();
			cancelOrder(order.OrderUuid, function(data){
				if(data.success){
					if(order.OrderType === 'LIMIT_SELL'){						
						adjustAskMap(params, order);
					}
					else if(order.OrderType === 'LIMIT_BUY'){
						adjustBidMap(params, order);
					}
				}
				//console.log(data);
			});
		}
	});
};

var cancelWide = function(params, callback){
	getBook(params, function(book){			
		if(params.stackBids){
			var bestBid = book.buy[params.cancelWidth-1];
			var bidPrice = bestBid.Rate;
			_.forEach(bidMap, function(order){
				if(bidPrice < order.Limit){
					cancelOrder(order.OrderUuid, function(data){
						if(data.success){
							adjustBidMap(params, order);
						}
						//console.log(data);
					});
				}
			});
		}
		
		if(params.stackAsks){
			var bestAsk = book.sell[params.cancelWidth-1];
			var askPrice = bestAsk.Rate;
			_.forEach(askMap, function(order){
				if(order.Limit < askPrice){
					cancelOrder(order.OrderUuid, function(data){
						if(data.success){
							adjustAskMap(params, order);
						}
						//console.log(data);
					});
				}
			});
		}
		callback();
	});
};

var restWide = function(params, callback){
	getBook(params, function(book){			
		if(params.stackBids){
			var bestBid = book.buy[params.restWidth-1];
			var currentPrice = bestBid.Rate;
			for(var bidCount = 0; bidCount < params.levels; bidCount++){
				if(!bidMap[currentPrice.toFixed(params.tickPrecision)]){
					buy(getSize(params), currentPrice, params, function(){}); 
				}
				currentPrice -= params.tickSize;
			}
		}

		if(params.stackAsks){
			var bestAsk = book.sell[params.restWidth-1];
			var currentPrice = bestAsk.Rate;
			for(var askCount = 0; askCount < params.levels; askCount++){
				if(!askMap[currentPrice.toFixed(params.tickPrecision)]){
					sell(getSize(params), currentPrice, params, function(){});
				}
				currentPrice += params.tickSize;
			}
		}
		
		callback();
	});
};

var detectFills = function(params, callback){
	getOpenOrders(params, function(orders){
		if(params.stackBids){
			var bidPrices = orders
				.filter(function(order){
					return order.OrderType === 'LIMIT_BUY';
				})
				.map(function(order){
					return order.Limit.toFixed(params.tickPrecision);
				});
			var mappedBidPrices = _.keys(bidMap);
			var removeBidPrices = _.difference(mappedBidPrices, bidPrices);
			while(removeBidPrices.length){
				var px = removeBidPrices.pop();
				delete bidMap[px];
			}
		}
		
		if(params.stackAsks){
			var askPrices = orders
				.filter(function(order){
					return order.OrderType === 'LIMIT_SELL';
				})
				.map(function(order){
					return order.Limit.toFixed(params.tickPrecision);
				});
			var mappedAskPrices = _.keys(askMap);
			var removeAskPrices = _.difference(mappedAskPrices, askPrices);
			while(removeAskPrices.length){
				var px = removeAskPrices.pop();
				delete askMap[px];
			}
		}
		callback();
	});
};

var stackerRunning = false;
var runStacker = function(params){
	log('Stacker Started');
	stackerRunning = true;
	var runMe = function(){
		detectFills(params, function(){
			cancelWide(params, function(){
				restWide(params, function(){
					if(stackerRunning){
						setTimeout(runMe, 500);
					}else{
						log('Stacker Stopped');
					}
				});				
			});
		});
	}
	runMe();
};

var bidMap = {};
var buy = function(quantity, price, params, callback){
	var px = price.toFixed(params.tickPrecision);
	var url = 'https://bittrex.com/api/v1.1/market/buylimit?apiKey=' + apiKey + '&market=' + params.symbol + '&quantity=' + quantity + '&rate=' + px;
	bittrex.sendCustomRequest( url, function( data ) {
		if(data.success){
			if(!bidMap[px]){
				bidMap[px] = [];
			}
			bidMap[px].push({orderId: data.result.uuid, quantity: quantity});
		}
		console.log(data.message);
		callback(data);
	}, true);
};

var askMap = {};
var sell = function(quantity, price, params, callback){
	var px = price.toFixed(params.tickPrecision);
	var url = 'https://bittrex.com/api/v1.1/market/selllimit?apiKey=' + apiKey + '&market=' + params.symbol + '&quantity=' + quantity + '&rate=' + px;
	bittrex.sendCustomRequest( url, function( data ) {
		if(data.success){
			if(!askMap[px]){
				askMap[px] = [];
			}
			askMap[px].push({orderId: data.result.uuid, quantity: quantity});
		}
		console.log(data.message);
		callback(data);
	}, true);
};

var getMidMarket = function(book){
	var bestAsk = book.sell[0].Rate;
	var bestBid = book.buy[0].Rate;
	return (bestAsk + bestBid)/2;
};

var restBids = function(params){
	getBook(params, function(book){
		var currentPrice = book.buy[params.restWidth-1].Rate;
		if(params.aggressiveRest){
			currentPrice = getMidMarket(book);
		}
		
		var bidCount = 0;
		var buyHandler = function(data){
			bidCount++;
			currentPrice -= params.tickSize;
			if(bidCount < params.levels){
				buy(getSize(params), currentPrice, params, buyHandler); 
			}
		};
		buy(getSize(params), currentPrice, params, buyHandler); 
	});
};

var restAsks = function(params){
	getBook(params, function(book){
		var currentPrice = book.sell[params.restWidth-1].Rate;
		if(params.aggressiveRest){
			currentPrice = getMidMarket(book);
		}
		var askCount = 0;
		var sellHandler = function(data){
			askCount++;
			currentPrice += params.tickSize;
			if(askCount < params.levels){
				sell(getSize(params), currentPrice, params, sellHandler); 
			}
		};
		sell(getSize(params), currentPrice, params, sellHandler); 
	});
};

var getSize = function(params){
	if(params.randomizeOrderSize){
		var dust = Number((Math.random()).toFixed(8));
		var min = params.orderSizeMin;
		var max = params.orderSizeMax;
		return Math.floor((Math.random() * (max - min)) + min) + dust;
	}else{
		return params.orderSize;
	}
};

var params = {
	'BTC-CANN': {
		symbol: 'BTC-CANN',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 42,
		orderSizeMin: 42,
		orderSizeMax: 420,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 40
	},
	'BTC-URO': {
		symbol: 'BTC-URO',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 0.5,
		orderSizeMin: 0.2,
		orderSizeMax: 2,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-CND': {
		symbol: 'BTC-CND',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 0.5,
		orderSizeMin: 42,
		orderSizeMax: 420,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-DSB': {
		symbol: 'BTC-DSB',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 4,
		orderSizeMin: 4,
		orderSizeMax: 20,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-SDC': {
		symbol: 'BTC-SDC',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 2.5,
		orderSizeMin: 2.5,
		orderSizeMax: 25,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-XC': {
		symbol: 'BTC-XC',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 1,
		orderSizeMin: 1,
		orderSizeMax: 10,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-SWIFT': {
		symbol: 'BTC-SWIFT',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 1.5,
		orderSizeMin: 1.5,
		orderSizeMax: 15,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	},
	'BTC-ULTC': {
		symbol: 'BTC-ULTC',
		aggressiveRest: false,
		restWidth: 5,
		cancelWidth: 2,
		tickSize: 0.00000001,
		tickPrecision: 8,
		orderSize: 0.3,
		orderSizeMin: 0.3,
		orderSizeMax: 3,
		randomizeOrderSize: true,
		stackBids: false,
		stackAsks: false,
		levels: 50
	}
};
var selectedSymbol = args['symbol'];
var selectedParams = params[selectedSymbol];

var sweep_bot = repl.start({
  prompt: "Stacker Bot> ",
  input: process.stdin,
  output: process.stdout,
  ignoreUndefined: true
});

sweep_bot.context.SetParam = function(param, value){
	params[selectedSymbol][param] = value;
}

sweep_bot.context.SelectSymbol = function(symbol){
	selectedParams = params[symbol];
};

sweep_bot.context.Book = function(){
	getBook(selectedParams, function(book){
		console.log("Best Bid: " + book.buy[0].Quantity + ", " + book.buy[0].Rate);
		console.log("Best Ask: " + book.sell[0].Quantity + ", " + book.sell[0].Rate);
	});
}

sweep_bot.context.Market = function(){
	getMarket(selectedParams, function(market){
		//console.log(market);
	});
}

sweep_bot.context.Orders = function(){
	getOpenOrders(selectedParams, function(market){
		//console.log(market);
	});
}

sweep_bot.context.Cancel = function(){
	cancelOpenOrders(selectedParams, function(market){
		//console.log(market);
	});
}

sweep_bot.context.Buy = function(quantity, price){
	buy(quantity, price, selectedParams, function(result){
		//console.log(result);
	});
}

sweep_bot.context.Sell = function(quantity, price){
	sell(quantity, price, selectedParams, function(result){
		//console.log(result);
	});
}

sweep_bot.context.RestBuys = function(){
	restBids(selectedParams);
}

sweep_bot.context.RestSells = function(){
	restAsks(selectedParams);
}

sweep_bot.context.StartStacker = function(){
	selectedParams.stackAsks = true;
	selectedParams.stackBids = true;
	runStacker(selectedParams);
};

sweep_bot.context.StackBids = function(){
	selectedParams.stackBids = true;
	if(!stackerRunning){
		runStacker(selectedParams);
	}
};

sweep_bot.context.StopBids = function(){
	selectedParams.stackBids = true;
	if(!selectedParams.stackAsks){
		stackerRunning = false;
	}
};

sweep_bot.context.StackAsks = function(){
	selectedParams.stackAsks = true;
	if(!stackerRunning){
		runStacker(selectedParams);
	}
};

sweep_bot.context.StopAsks = function(){
	selectedParams.stackAsks = true;
	if(!selectedParams.stackBids){
		stackerRunning = false;
	}
};

sweep_bot.context.StopStacker = function(){
	selectedParams.stackAsks = false;
	selectedParams.stackBids = false;
	stackerRunning = false;
};