// 승인 후 분실자와 습득자의 채팅방.
import express from 'express';
import { requireUser } from '../auth.js';
import { now } from '../db.js';
import { notFound, parseId, requiredString } from '../http.js';
import { notify } from '../moderation.js';

export function chatsRouter({ db }) {
  const router = express.Router();

  function loadRoom(req) {
    const room = db.prepare(`
      SELECT r.*, i.title AS item_title, i.status AS item_status,
        f.username AS finder_name, c.username AS claimant_name
      FROM chat_rooms r
      JOIN items i ON i.id = r.item_id
      JOIN users f ON f.id = r.finder_id
      JOIN users c ON c.id = r.claimant_id
      WHERE r.id = ?
    `).get(parseId(req.params.id));
    if (!room || ![room.finder_id, room.claimant_id].includes(req.user.id)) throw notFound();
    return room;
  }

  function roomView(room, userId) {
    const isFinder = room.finder_id === userId;
    return {
      id: room.id,
      itemId: room.item_id,
      itemTitle: room.item_title,
      itemStatus: room.item_status,
      role: isFinder ? 'finder' : 'claimant',
      otherParty: isFinder ? room.claimant_name : room.finder_name,
    };
  }

  router.get('/chats', requireUser, (req, res) => {
    const rooms = db.prepare(`
      SELECT r.*, i.title AS item_title, i.status AS item_status,
        f.username AS finder_name, c.username AS claimant_name,
        (SELECT body FROM chat_messages m WHERE m.room_id = r.id ORDER BY m.id DESC LIMIT 1) AS last_message
      FROM chat_rooms r
      JOIN items i ON i.id = r.item_id
      JOIN users f ON f.id = r.finder_id
      JOIN users c ON c.id = r.claimant_id
      WHERE r.finder_id = ? OR r.claimant_id = ?
      ORDER BY r.id DESC
    `).all(req.user.id, req.user.id);
    res.json({ rooms: rooms.map((r) => ({ ...roomView(r, req.user.id), lastMessage: r.last_message })) });
  });

  router.get('/chats/:id', requireUser, (req, res) => {
    const room = loadRoom(req);
    const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
    const messages = db.prepare(`
      SELECT m.id, m.body, m.created_at, m.sender_id, u.username
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ? AND m.id > ? ORDER BY m.id LIMIT 200
    `).all(room.id, after);
    res.json({
      room: roomView(room, req.user.id),
      messages: messages.map((m) => ({
        id: m.id, body: m.body, createdAt: m.created_at, sender: m.username, mine: m.sender_id === req.user.id,
      })),
    });
  });

  router.post('/chats/:id/messages', requireUser, (req, res) => {
    const room = loadRoom(req);
    const body = requiredString(req.body, 'body', '메시지', { max: 1000 });
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO chat_messages (room_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)
    `).run(room.id, req.user.id, body, now());
    const other = room.finder_id === req.user.id ? room.claimant_id : room.finder_id;
    const unreadFromRoom = db.prepare(`
      SELECT 1 FROM notifications WHERE user_id = ? AND link = ? AND is_read = 0
    `).get(other, `/chats/${room.id}`);
    if (!unreadFromRoom) notify(db, other, `"${room.item_title}" 채팅방에 새 메시지가 있습니다.`, `/chats/${room.id}`);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  return router;
}
