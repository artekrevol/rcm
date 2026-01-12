#!/bin/bash
# Railway post-deploy script to seed the database
# This script can be run manually after deployment or added to Railway's postdeploy hook

echo "Running database seed..."
npm run seed



