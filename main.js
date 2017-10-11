var fs = require('fs');
var io = require('socket.io')(3000);

var chatRooms = [];
var chatNicks = [];
var clientNicks = [];
var chatHistory = [];

io.on('connection', function (socket) {
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

  socket.on('setnick', function (data) {
    if(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]) > -1)
    {
      chatNicks[socket.handshake.query.room].splice(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]),1);
      delete clientNicks[socket.id];
    }
    chatNicks[socket.handshake.query.room].push(data.nick);
    clientNicks[socket.id] = data.nick;
    io.to(socket.handshake.query.room).emit('nicks', {nicks: chatNicks[socket.handshake.query.room]});
  });

  socket.on('disconnect', function() {
    if(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]) > -1)
    {
      chatNicks[socket.handshake.query.room].splice(chatNicks[socket.handshake.query.room].indexOf(clientNicks[socket.id]),1);
      delete clientNicks[socket.id];
      io.to(socket.handshake.query.room).emit('nicks', {nicks: chatNicks[socket.handshake.query.room]});
    }
  });

  socket.on('message', function (data) {
    if(!(clientNicks[socket.id] === undefined))
    {
      var msgTime = (new Date()).toISOString(); //"2011-12-19T15:28:46.493Z"
      var msgLine = { time: msgTime, name: clientNicks[socket.id], message: data.message };
      io.to(socket.handshake.query.room).emit('message', msgLine);
      chatHistory[socket.handshake.query.room].push(msgLine);
      logMessage(socket.handshake.query.room,msgLine);
    }
  });
});

setInterval(function() {
  chatRooms.forEach(function(room) {
    if(typeof io.sockets.adapter.rooms[room] !== "undefined")
    {
      io.to(room).emit('viewers', { num: Object.keys(io.sockets.adapter.rooms[room].sockets).length });
    }
  });
},5*1000);

setInterval(function() {
  var sevenDaysAgo = new Date().getTime() - (7 * 24 * 60 * 60 * 1000);
  for (var roomKey in chatHistory) {
    if (chatHistory.hasOwnProperty(roomKey)) {
      var roomHistory = chatHistory[roomKey];
       for (var rowKey in roomHistory) {
          if(roomHistory.hasOwnProperty(rowKey)){
            if(Date.parse(roomHistory[rowKey].time) < sevenDaysAgo)
            {
              roomHistory.splice(rowKey,1);
            }
          }
       }
    }
  }
},10*60*1000);

function ensureExists(path, mask, cb) {
    if (typeof mask == 'function') { // allow the `mask` parameter to be optional
        cb = mask;
        mask = 0777;
    }
    fs.mkdir(path, mask, function(err) {
        if (err) {
            if (err.code == 'EEXIST') cb(null); // ignore the error if the folder already exists
            else cb(err); // something else went wrong
        } else cb(null); // successfully created folder
    });
}

function logMessage(room,line)
{
  ensureExists(__dirname + '/logs', 0744, function(err)
  {
    if (!err)
    {
      ensureExists(__dirname + '/logs/' + room, 0744, function(err)
      {
        if(!err)
        {
          fs.appendFile(__dirname + '/logs/' + room + '/' + line.time.substring(0,10) + '.txt', JSON.stringify(line) + '\n', function (err) { });
        }
      });
    }
  });
}

console.log("Running");

