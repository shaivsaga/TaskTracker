#!/bin/bash
cp /home/site/nginx-default.conf /etc/nginx/sites-available/default
nginx -t && service nginx reload
