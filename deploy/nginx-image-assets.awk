function emit_proxy() {
  print "        proxy_pass http://127.0.0.1:3000;"
  print "        proxy_http_version 1.1;"
  print "        proxy_set_header Host $host;"
  print "        proxy_set_header X-Forwarded-Host $host;"
  print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
  print "        proxy_set_header X-Forwarded-Proto $scheme;"
  print "        add_header X-Content-Type-Options nosniff always;"
  print "        access_log off;"
  print "    }"
}

!in_block && /^    location/ && index($0, "_next/static/ {") {
  if (next_count++) exit 2
  print "    location ^~ /_next/static/ {"
  emit_proxy()
  in_block = 1
  next
}

!in_block && /^    location/ && index($0, "location ~* ^/(fonts|icons|hero)/ {") {
  if (public_count++) exit 2
  print "    location ~* ^/(fonts|icons|hero)/ {"
  emit_proxy()
  in_block = 1
  next
}

in_block && $0 == "    }" {
  in_block = 0
  next
}

!in_block { print }

END {
  if (in_block || next_count != 1 || public_count != 1) exit 3
}
