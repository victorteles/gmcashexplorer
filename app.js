var express = require('express')
  , path = require('path')
  , bitcoinapi = require('bitcoin-node-api')
  , favicon = require('static-favicon')
  , logger = require('morgan')
  , cookieParser = require('cookie-parser')
  , bodyParser = require('body-parser')
  , settings = require('./lib/settings')
  , routes = require('./routes/index')
  , lib = require('./lib/explorer')
  , db = require('./lib/database')
  , locale = require('./lib/locale')
  , request = require('request');

var app = express();

// bitcoinapi
bitcoinapi.setWalletDetails(settings.wallet);
if (settings.heavy != true) {
  bitcoinapi.setAccess('only', ['getinfo', 'getnetworkhashps', 'getmininginfo','getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getpeerinfo', 'gettxoutsetinfo']);
} else {
  // enable additional heavy api calls
  /*
    getvote - Returns the current block reward vote setting.
    getmaxvote - Returns the maximum allowed vote for the current phase of voting.
    getphase - Returns the current voting phase ('Mint', 'Limit' or 'Sustain').
    getreward - Returns the current block reward, which has been decided democratically in the previous round of block reward voting.
    getnextrewardestimate - Returns an estimate for the next block reward based on the current state of decentralized voting.
    getnextrewardwhenstr - Returns string describing how long until the votes are tallied and the next block reward is computed.
    getnextrewardwhensec - Same as above, but returns integer seconds.
    getsupply - Returns the current money supply.
    getmaxmoney - Returns the maximum possible money supply.
  */
  bitcoinapi.setAccess('only', ['getinfo', 'getstakinginfo', 'getnetworkhashps', 'getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction','getmaxmoney', 'getvote',
    'getmaxvote', 'getphase', 'getreward', 'getnextrewardestimate', 'getnextrewardwhenstr',
    'getnextrewardwhensec', 'getsupply', 'gettxoutsetinfo']);
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(path.join(__dirname, settings.favicon)));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// routes
app.use('/api', bitcoinapi.app);
app.use('/', routes);
app.use('/ext/getmoneysupply', function(req,res){
  lib.get_supply(function(supply){
    res.send(' '+supply);
  });
});

app.use('/ext/getaddress/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };
      res.send(a_ext);
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getbalance/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      res.send((address.balance / 100000000).toString().replace(/(^-+)/mg, ''));
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getdistribution', function(req,res){
  db.get_richlist(settings.coin, function(richlist){
    db.get_stats(settings.coin, function(stats){
      db.get_distribution(richlist, stats, function(dist){
        res.send(dist);
      });
    });
  });
});

app.use('/ext/getlasttxs/:min', function(req,res){
  db.get_last_txs(settings.index.last_txs, (req.params.min * 100000000), function(txs){
    res.send({data: txs});
  });
});

app.use('/ext/connections', function(req,res){
  db.get_peers(function(peers){
    res.send({data: peers});
  });
});

app.use('/ext/getTransaction/:hash/:address', function(req,res){
	db.get_tx(req.param('hash'), function(tx) {
        if (tx) {
          var vin = 0;
          var amount = 0;
          var address_send = [];
          var vins = tx.vin;
          vins.forEach(function(i) {
       	  address_send.push(i.addresses);
   		  if (req.param('address') == i.addresses)
   			   vin +=i.amount;
				});
          var vouts = tx.vout;
          var own_after = 0;
          var address_re = [];
          vouts.forEach(function(o) {
   		   if (req.param('address') == o.addresses)
   			   own_after +=o.amount;
   		   else
   			   address_re.push(o.addresses);
				});
          if(vin > 0){
       	   if (own_after==0){
       		   amount -=vin;
       	   }
       	   else
       		   amount = own_after - vin;
          }
          else
       	   	   amount = own_after ;
          txs = {'time':tx.timestamp,'toaddess':address_re,'fromaddess':address_send,'amount':amount/ 100000000};
          res.send({txs: txs});
        }
        else
        	res.send({txs: {}});
	});
});

app.use('/ext/getaddresstrans/:hash', function(req,res){
	  count = 9999999999;
	  db.get_address(req.param('hash'), function(address){
	    if (address) {
	    	 var a_ext = {
	    		        address: address.a_id,
	    		        sent: (address.sent / 100000000),
	    		        received: (address.received / 100000000),
	    		        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
	    		      };
	    	 var txs = [];
	         var hashes = address.txs.reverse();
	         if (address.txs.length < count) {
	           count = address.txs.length;
	         }
	         lib.syncLoop(count, function (loop) {
	           var i = loop.iteration();
	           db.get_tx(hashes[i].addresses, function(tx) {
	             if (tx) {
	               var vin = 0;
	               var amount = 0;
	               var address_send = [];
	               var vins = tx.vin;
	               vins.forEach(function(i) {
	            	   address_send.push(i.addresses);
            		   if (req.param('hash') == i.addresses)
            			   vin +=i.amount;
   					});
	               var vouts = tx.vout;
	               var own_after = 0;
	               var address_re = [];
	               vouts.forEach(function(o) {
            		   if (req.param('hash') == o.addresses)
            			   own_after +=o.amount;
            		   else
            			   address_re.push(o.addresses);
   					});
	               if(vin > 0){
	            	   if (own_after==0){
	            		   amount -=vin;
	            	   }
	            	   else
	            		   amount = own_after - vin;
	               }
	               else
	            	   amount = own_after ;
	               txs.push({'txid':tx.txid,'time':tx.timestamp,'toaddess':address_re,'fromaddess':address_send,'amount':amount/ 100000000});
	               loop.next();
	             } else {
	               loop.next();
	             }
	           });
	         }, function(){
	        	 res.send({data: a_ext, txs: txs});
	         });
	      
	    } else {
	      res.send({ error: 'address not found.', hash: req.param('hash')})
	    }
	  });
	});

// locals
app.set('title', settings.title);
app.set('symbol', settings.symbol);
app.set('coin', settings.coin);
app.set('locale', locale);
app.set('display', settings.display);
app.set('markets', settings.markets);
app.set('twitter', settings.twitter);
app.set('genesis_block', settings.genesis_block);
app.set('index', settings.index);
app.set('heavy', settings.heavy);
app.set('txcount', settings.txcount);
app.set('nethash', settings.nethash);
app.set('nethash_units', settings.nethash_units);
app.set('show_sent_received', settings.show_sent_received);
app.set('logo', settings.logo);
app.set('theme', settings.theme);
app.set('labels', settings.labels);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
