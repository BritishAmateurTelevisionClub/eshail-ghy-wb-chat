#!/usr/bin/env node

const fs = require('fs');
var io = require('socket.io')(3000);
var irc = require('irc-upd');
var striptags = require('striptags');

var chatRooms = [];
var chatNicks = [];
var clientNicks = [];
var chatHistory = [];

var ircNicks = [];

const days_history = 1;
const log_path = '/logs/';

// Reverse Map
function TwoWayMap(map)
{
   this.map = map;
   this.reverseMap = {};
   for(var key in map)
   {
      var value = map[key];
      this.reverseMap[value] = key;   
   }
  this.keys = Object.keys(map);
}
TwoWayMap.prototype.map = function(){ return this.map; };
TwoWayMap.prototype.keys = function(){ return this.keys; };
TwoWayMap.prototype.get = function(key){ return this.map[key]; };
TwoWayMap.prototype.revGet = function(key){ return this.reverseMap[key]; };

var irc_channels = new TwoWayMap({
  "#es'hail-2-wb": 'eshail-wb',
//  "#es'hail-2": 'eshail-nb'
});

/* Pre-populate chatNicks arrays */
for(var channel in irc_channels.map)
{
  ircNicks[channel] = [];
  chatNicks[irc_channels.get(channel)] = [];
}

var irc_client = new irc.Client('irc.freenode.net', 'ghy', {
  userName: 'ghy-webchat',
  realName: 'Goonhilly QO-100 Webchat',
  channels: irc_channels.keys,
  autoRejoin: true,
});

/* Get list of people in channel */
setInterval(function()
{
  //irc_client.say("#es'hail-2-wb", "SRSLY, I AM!");
  /* Send raw 'NAMES' message */
  irc_client.send('NAMES', "#es'hail-2-wb");
},20*1000);

irc_client.addListener('names', function (channel, nicks)
{
  //console.log(channel, '>', nicks);
  if(ircNicks[channel] !== undefined)
  {
    ircNicks[channel].length = 0;
  }
  ircNicks[channel] = Object.keys(nicks);
  /* Remove bot from nicklist */
  var selfIndex = ircNicks[channel].indexOf('ghy');
  if (selfIndex > -1)
  {
    ircNicks[channel].splice(selfIndex, 1);
  }
  /* Send to webpage clients */
  io.to(irc_channels.get(channel)).emit('nicks', {nicks: chatNicks[irc_channels.get(channel)].concat(ircNicks[channel]) });
});

// Generic IRC server-error handler
irc_client.addListener('error', function(message)
{
    console.log('irc server error: ', message);
});

irc_client.addListener('message', function (from, to, message)
{
  console.log(from + ' => ' + to + ': ' + message);
  if(irc_channels.get(to) !== undefined)
  {
    var channel = irc_channels.get(to);
    var msgTime = (new Date()).toISOString(); //"2011-12-19T15:28:46.493Z"
    var msgLine = { time: msgTime, name: from, message: message };
    // Broadcast to web clients
    io.to(channel).emit('message', msgLine);
    // Create chatroom if it doesn't exist
    if(chatRooms.indexOf(channel) == -1)
    {
      chatRooms.push(channel);
    }
    // Save to history
    chatHistory[channel].push(msgLine);
    logMessage(channel, msgLine);
    console.log(msgLine);
  }
});

io.on('connection', function (socket)
{
  socket.join(socket.handshake.query.room);
  if(chatRooms.indexOf(socket.handshake.query.room) == -1)
  {
    chatRooms.push(socket.handshake.query.room);
    if(socket.handshake.query.nick === undefined)
    {
      chatNicks[socket.handshake.query.room] = [];
    }
    else
    {
      chatNicks[socket.handshake.query.room] = [socket.handshake.query.nick];
    }
    chatHistory[socket.handshake.query.room] = [];
  }
  socket.emit('history', {nicks: chatNicks[socket.handshake.query.room], history: chatHistory[socket.handshake.query.room]});

  if(typeof io.sockets.adapter.rooms[socket.handshake.query.room] !== "undefined")
  {
      socket.emit('viewers', { num: Object.keys(io.sockets.adapter.rooms[socket.handshake.query.room].sockets).length } );
  }

  socket.on('setnick', function (data)
  {
    if(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]) > -1)
    {
      chatNicks[socket.handshake.query.room].splice(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]),1);
      delete clientNicks[socket.id];
    }
    chatNicks[socket.handshake.query.room].push(data.nick);
    clientNicks[socket.id] = data.nick;
    io.to(socket.handshake.query.room).emit('nicks', {nicks: chatNicks[socket.handshake.query.room].concat(ircNicks[irc_channels.revGet(socket.handshake.query.room)]) });
  });

  socket.on('disconnect', function()
  {
    if(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]) > -1)
    {
      chatNicks[socket.handshake.query.room].splice(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]),1);
      delete clientNicks[socket.id];
      io.to(socket.handshake.query.room).emit('nicks', {nicks: chatNicks[socket.handshake.query.room].concat(ircNicks[irc_channels.revGet(socket.handshake.query.room)]) });
    }
  });

  socket.on('message', function (data)
  {
    if(!(clientNicks[socket.id] === undefined))
    {
      var msgTime = (new Date()).toISOString(); //"2011-12-19T15:28:46.493Z"
      var msgLine = { time: msgTime, name: clientNicks[socket.id], message: data.message };
      io.to(socket.handshake.query.room).emit('message', msgLine);
      chatHistory[socket.handshake.query.room].push(msgLine);
      logMessage(socket.handshake.query.room,msgLine);
      // Send to IRC
      if(irc_channels.revGet(socket.handshake.query.room) !== undefined)
      {
        irc_client.say(irc_channels.revGet(socket.handshake.query.room), "< "+irc.colors.wrap('bold', clientNicks[socket.id])+" > "+data.message);
      }
    }
  });
});

setInterval(function()
{
  chatRooms.forEach(function(room)
  {
    if(typeof io.sockets.adapter.rooms[room] !== "undefined")
    {
      io.to(room).emit('viewers', { num: Object.keys(io.sockets.adapter.rooms[room].sockets).length });
    }
  });
},5*1000);

setInterval(function()
{
  var sevenDaysAgo = new Date().getTime() - (days_history * 24 * 60 * 60 * 1000);
  for (var roomKey in chatHistory)
  {
    if (chatHistory.hasOwnProperty(roomKey))
    {
    var roomHistory = chatHistory[roomKey];
    for (var rowKey in roomHistory)
    {
      if(roomHistory.hasOwnProperty(rowKey))
      {
        if(Date.parse(roomHistory[rowKey].time) < sevenDaysAgo)
        {
          roomHistory.splice(rowKey,1);
        }
      }
    }
    }
  }
},10*60*1000); // 10 minutes

function ensureExists(path, mask, cb)
{
  if (typeof mask == 'function')
  {
    cb = mask;
    mask = 0777;
  }
  fs.mkdir(path, mask, function(err)
  {
    if (err)
    {
      if (err.code == 'EEXIST')
      {
        cb(null); // ignore the error if the folder already exists
      }
      else
      {
        cb(err); // something else went wrong
      }
    }
    else
    {
      cb(null); // successfully created folder
    }
  });
}

const hrefRegex = /((?:(http|https|Http|Https):\/\/(?:(?:[a-zA-Z0-9\$\-\_\.\+\!\*\'\(\)\,\;\?\&\=]|(?:\%[a-fA-F0-9]{2})){1,64}(?:\:(?:[a-zA-Z0-9\$\-\_\.\+\!\*\'\(\)\,\;\?\&\=]|(?:\%[a-fA-F0-9]{2})){1,25})?\@)?)?((?:(?:[a-zA-Z0-9][a-zA-Z0-9\-]{0,64}\.)+(?:(?:aero|arpa|asia|a[cdefgilmnoqrstuwxz])|(?:biz|b[abdefghijmnorstvwyz])|(?:cat|com|coop|c[acdfghiklmnoruvxyz])|d[ejkmoz]|(?:edu|e[cegrstu])|f[ijkmor]|(?:gov|g[abdefghilmnpqrstuwy])|h[kmnrtu]|(?:info|int|i[delmnoqrst])|(?:jobs|j[emop])|k[eghimnrwyz]|l[abcikrstuvy]|(?:mil|mobi|museum|m[acdghklmnopqrstuvwxyz])|(?:name|net|n[acefgilopruz])|(?:org|om)|(?:pro|p[aefghklmnrstwy])|qa|r[eouw]|s[abcdeghijklmnortuvyz]|(?:tel|travel|t[cdfghjklmnoprtvwz])|u[agkmsyz]|v[aceginu]|w[fs]|y[etu]|z[amw]))|(?:(?:25[0-5]|2[0-4][0-9]|[0-1][0-9]{2}|[1-9][0-9]|[1-9])\.(?:25[0-5]|2[0-4][0-9]|[0-1][0-9]{2}|[1-9][0-9]|[1-9]|0)\.(?:25[0-5]|2[0-4][0-9]|[0-1][0-9]{2}|[1-9][0-9]|[1-9]|0)\.(?:25[0-5]|2[0-4][0-9]|[0-1][0-9]{2}|[1-9][0-9]|[0-9])))(?:\:\d{1,5})?)(\/(?:(?:[a-zA-Z0-9\;\/\?\:\@\&\=\#\~\-\.\+\!\*\'\(\)\,\_])|(?:\%[a-fA-F0-9]{2}))*)?(?:\b|$)/gi;

var messageStripAndHrefs = function(msg)
{
  return striptags(msg).replace(hrefRegex, function(url)
  {
    return '<a href="' + url + '" target="_blank">' + url + '</a>';
  });
}

function logMessage(room,line)
{
  ensureExists(__dirname + log_path, 0744, function(err)
  {
    if (!err)
    {
      ensureExists(__dirname + log_path + room, 0744, function(err)
      {
        if(!err)
        {
          var log_filename = __dirname + log_path + room + '/' + line.time.substring(0,10) + '.html';
          fs.access(log_filename, fs.F_OK, function(err)
          {
            if(err)
            {
              // file does not exist
              var date = line.time.substring(0,10);
              var content = `<html>
<head>
  <title>${date} WB Chat Log</title>
  <meta http-equiv="content-type" content="text/html; charset=utf-8">
  <style>
  body {
    background: #3F464C;
    color: #ccc;
    font-family: "Lucida Sans Unicode", "Lucida Grande", sans-serif;
    font-size: 90%;
    line-height: 1.5;
    position: relative;
  }
  .message-object {
    padding-bottom: 1px;
  }
  .message-timestamp {
    color: #b0b0b0;
    padding-right: 0.75em;
  }
  .message-nick {
    font-weight: bold;
    color: #FBDE2D;
    padding-right: 0.75em;
  }
  .message-text {
    margin-left: 0em;
  }
  </style>
</head>
<body>
  <h2>${date}</h2>
</body>
</html>`;
              fs.appendFile(log_filename, content, function (err) { });
            }

            // file exists, or now exists

            // read the file in
            fs.readFile(log_filename, "utf-8", function(err, text)
            {
              // find end of array
              if(!err)
              {
                var insert_position = text.indexOf('</body>');
                var insert_text = `
<div class="message-object">
  <span class="message-timestamp">${line.time.substring(11,19)}Z</span>
  <span class="message-nick">${line.name}</span>
  <span class="message-text">${messageStripAndHrefs(line.message)}</span>
</div>`;
                var output = [text.slice(0, insert_position), insert_text, text.slice(insert_position)].join('');

                fs.writeFile(log_filename, output, function (err) { });
              }
            });
          });
        }
      });
    }
  });
}

console.log("Running");
console.log(" - Node", process.version);
