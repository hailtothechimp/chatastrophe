"""Run this from the backend/ directory to create a user account.

Usage:
    python create_user.py <username> <password>
"""
import asyncio
import sys
import bcrypt
import db


async def main():
    if len(sys.argv) != 3:
        print("Usage: python create_user.py <username> <password>")
        sys.exit(1)

    username = sys.argv[1].strip().lower()
    password = sys.argv[2]

    await db.init_db()
    existing = await db.get_user(username)
    if existing:
        print(f"User '{username}' already exists.")
        sys.exit(1)

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = await db.create_user(username, hashed)
    print(f"Created user: {user['username']} (at {user['created_at']})")


asyncio.run(main())
